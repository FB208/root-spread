from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from rootspread_api.api.dependencies.auth import get_current_user
from rootspread_api.core.database import get_db
from rootspread_api.core.security import create_access_token, hash_password, verify_password
from rootspread_api.core.time import utc_now
from rootspread_api.models.user import User
from rootspread_api.schemas.auth import (
    AuthTokenResponse,
    LoginRequest,
    RefreshTokenRequest,
    RegisterRequest,
    RegisterResponse,
    ResendVerificationRequest,
    UserRead,
    VerificationDispatchResponse,
    VerifyEmailRequest,
)
from rootspread_api.schemas.common import MessageResponse
from rootspread_api.services.auth_tokens import (
    get_email_verification_record,
    get_refresh_token_record,
    issue_email_verification_token,
    issue_refresh_token,
    should_expose_debug_token,
)
from rootspread_api.services.email_service import send_verification_email

router = APIRouter(prefix="/auth", tags=["auth"])


@router.post("/register", response_model=RegisterResponse, status_code=status.HTTP_201_CREATED)
def register(payload: RegisterRequest, session: Session = Depends(get_db)) -> RegisterResponse:
    normalized_email = payload.email.lower()
    existing_user = session.scalar(select(User).where(User.email == normalized_email))
    if existing_user is not None:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="该邮箱已注册。")

    display_name = payload.display_name or normalized_email.split("@")[0]
    user = User(
        email=normalized_email,
        password_hash=hash_password(payload.password),
        display_name=display_name,
    )
    session.add(user)
    session.flush()

    verification_token = issue_email_verification_token(session, user.id)
    session.commit()
    session.refresh(user)

    send_verification_email(user.email, user.display_name, verification_token)
    return RegisterResponse(
        message="注册成功，请查收验证邮件。",
        user=UserRead.model_validate(user),
        debug_verification_token=verification_token if should_expose_debug_token() else None,
    )


@router.post("/verify-email", response_model=MessageResponse)
def verify_email(
    payload: VerifyEmailRequest, session: Session = Depends(get_db)
) -> MessageResponse:
    record = get_email_verification_record(session, payload.token)
    if record is None or record.used_at is not None or record.expires_at <= utc_now():
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="验证链接无效或已过期。"
        )

    record.used_at = utc_now()
    record.user.email_verified_at = utc_now()
    session.commit()
    return MessageResponse(message="邮箱验证成功。")


@router.post("/verify-email/resend", response_model=VerificationDispatchResponse)
def resend_verification_email(
    payload: ResendVerificationRequest,
    session: Session = Depends(get_db),
) -> VerificationDispatchResponse:
    user = session.scalar(select(User).where(User.email == payload.email.lower()))

    if user is None:
        return VerificationDispatchResponse(message="如果邮箱存在，验证邮件已重新发送。")

    if user.email_verified_at is not None:
        return VerificationDispatchResponse(message="该邮箱已经完成验证。")

    verification_token = issue_email_verification_token(session, user.id)
    session.commit()
    send_verification_email(user.email, user.display_name, verification_token)
    return VerificationDispatchResponse(
        message="验证邮件已重新发送。",
        debug_verification_token=verification_token if should_expose_debug_token() else None,
    )


@router.post("/login", response_model=AuthTokenResponse)
def login(payload: LoginRequest, session: Session = Depends(get_db)) -> AuthTokenResponse:
    user = session.scalar(select(User).where(User.email == payload.email.lower()))
    if user is None or not verify_password(payload.password, user.password_hash):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="邮箱或密码错误。")

    if user.email_verified_at is None:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="请先完成邮箱验证。")

    access_token, expires_in = create_access_token(user.id, user.email)
    refresh_token = issue_refresh_token(session, user.id)
    session.commit()

    return AuthTokenResponse(
        access_token=access_token,
        refresh_token=refresh_token,
        expires_in=expires_in,
        user=UserRead.model_validate(user),
    )


@router.post("/refresh", response_model=AuthTokenResponse)
def refresh_tokens(
    payload: RefreshTokenRequest,
    session: Session = Depends(get_db),
) -> AuthTokenResponse:
    record = get_refresh_token_record(session, payload.refresh_token)
    if record is None or record.revoked_at is not None or record.expires_at <= utc_now():
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="刷新令牌无效。")

    user = record.user
    if user.status != "active":
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="用户不可用。")

    record.revoked_at = utc_now()
    new_refresh_token = issue_refresh_token(session, user.id)
    access_token, expires_in = create_access_token(user.id, user.email)
    session.commit()

    return AuthTokenResponse(
        access_token=access_token,
        refresh_token=new_refresh_token,
        expires_in=expires_in,
        user=UserRead.model_validate(user),
    )


@router.post("/logout", response_model=MessageResponse)
def logout(payload: RefreshTokenRequest, session: Session = Depends(get_db)) -> MessageResponse:
    record = get_refresh_token_record(session, payload.refresh_token)
    if record is not None and record.revoked_at is None:
        record.revoked_at = utc_now()
        session.commit()

    return MessageResponse(message="已退出登录。")


@router.get("/me", response_model=UserRead)
def me(current_user: User = Depends(get_current_user)) -> UserRead:
    return UserRead.model_validate(current_user)
