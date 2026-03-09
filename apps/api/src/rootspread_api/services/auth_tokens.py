from datetime import timedelta

from sqlalchemy import select
from sqlalchemy.orm import Session

from rootspread_api.core.config import get_settings
from rootspread_api.core.security import create_random_token, hash_token
from rootspread_api.core.time import utc_now
from rootspread_api.models.auth import EmailVerificationToken, RefreshToken


def issue_email_verification_token(session: Session, user_id: str) -> str:
    settings = get_settings()
    token = create_random_token()
    record = EmailVerificationToken(
        user_id=user_id,
        token_hash=hash_token(token),
        expires_at=utc_now() + timedelta(hours=settings.email_verification_ttl_hours),
    )
    session.add(record)
    return token


def get_email_verification_record(session: Session, token: str) -> EmailVerificationToken | None:
    return session.scalar(
        select(EmailVerificationToken).where(EmailVerificationToken.token_hash == hash_token(token))
    )


def issue_refresh_token(session: Session, user_id: str) -> str:
    settings = get_settings()
    token = create_random_token()
    record = RefreshToken(
        user_id=user_id,
        token_hash=hash_token(token),
        expires_at=utc_now() + timedelta(days=settings.refresh_token_ttl_days),
    )
    session.add(record)
    return token


def get_refresh_token_record(session: Session, token: str) -> RefreshToken | None:
    return session.scalar(select(RefreshToken).where(RefreshToken.token_hash == hash_token(token)))


def should_expose_debug_token() -> bool:
    return get_settings().app_env in {"development", "testing"}
