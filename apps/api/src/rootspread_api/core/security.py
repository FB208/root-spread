import hashlib
import secrets
from datetime import timedelta

from jose import JWTError, jwt
from passlib.context import CryptContext

from rootspread_api.core.config import get_settings
from rootspread_api.core.time import utc_now

pwd_context = CryptContext(schemes=["pbkdf2_sha256"], deprecated="auto")
ALGORITHM = "HS256"


def hash_password(password: str) -> str:
    return pwd_context.hash(password)


def verify_password(plain_password: str, password_hash: str) -> bool:
    return pwd_context.verify(plain_password, password_hash)


def create_access_token(user_id: str, email: str) -> tuple[str, int]:
    settings = get_settings()
    expires_delta = timedelta(minutes=settings.access_token_ttl_minutes)
    expires_at = utc_now() + expires_delta
    encoded = jwt.encode(
        {
            "sub": user_id,
            "email": email,
            "typ": "access",
            "exp": expires_at,
        },
        settings.jwt_secret,
        algorithm=ALGORITHM,
    )
    return encoded, int(expires_delta.total_seconds())


def decode_access_token(token: str) -> dict[str, str]:
    settings = get_settings()

    try:
        payload = jwt.decode(token, settings.jwt_secret, algorithms=[ALGORITHM])
    except JWTError as exc:  # pragma: no cover - exact jose messages are implementation details
        raise ValueError("Invalid access token") from exc

    if payload.get("typ") != "access" or not payload.get("sub"):
        raise ValueError("Invalid access token")

    return payload


def create_random_token() -> str:
    return secrets.token_urlsafe(48)


def hash_token(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()
