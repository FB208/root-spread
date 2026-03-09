from datetime import datetime

from pydantic import BaseModel, EmailStr, Field, field_validator

from rootspread_api.schemas.common import MessageResponse, ORMModel


class RegisterRequest(BaseModel):
    email: EmailStr
    password: str = Field(min_length=8, max_length=128)
    display_name: str | None = Field(default=None, min_length=2, max_length=120)

    @field_validator("display_name")
    @classmethod
    def normalize_display_name(cls, value: str | None) -> str | None:
        return value.strip() if value else value


class LoginRequest(BaseModel):
    email: EmailStr
    password: str = Field(min_length=8, max_length=128)


class VerifyEmailRequest(BaseModel):
    token: str = Field(min_length=20, max_length=255)


class ResendVerificationRequest(BaseModel):
    email: EmailStr


class RefreshTokenRequest(BaseModel):
    refresh_token: str = Field(min_length=20, max_length=255)


class UserRead(ORMModel):
    id: str
    email: EmailStr
    display_name: str
    avatar_url: str | None
    email_verified_at: datetime | None
    status: str
    created_at: datetime
    updated_at: datetime


class AuthTokenResponse(BaseModel):
    access_token: str
    refresh_token: str
    token_type: str = "bearer"
    expires_in: int
    user: UserRead


class VerificationDispatchResponse(MessageResponse):
    debug_verification_token: str | None = None


class RegisterResponse(VerificationDispatchResponse):
    user: UserRead
