from fastapi import Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer
from sqlalchemy.orm import Session

from rootspread_api.core.database import get_db
from rootspread_api.core.security import decode_access_token
from rootspread_api.models.user import User

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/v1/auth/login")


def get_current_user(
    token: str = Depends(oauth2_scheme),
    session: Session = Depends(get_db),
) -> User:
    try:
        payload = decode_access_token(token)
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="登录状态无效，请重新登录。",
        ) from exc

    user = session.get(User, payload["sub"])
    if user is None or user.status != "active":
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="用户不存在或已被禁用。",
        )

    return user


def get_current_verified_user(current_user: User = Depends(get_current_user)) -> User:
    if current_user.email_verified_at is None:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="请先完成邮箱验证。",
        )

    return current_user
