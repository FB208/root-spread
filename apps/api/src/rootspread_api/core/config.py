from functools import lru_cache
from pathlib import Path

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict

APP_DIR = Path(__file__).resolve().parents[3]
REPO_DIR = APP_DIR.parents[1]


class Settings(BaseSettings):
    app_name: str = "RootSpread API"
    app_env: str = "development"
    api_v1_prefix: str = "/api/v1"
    app_host: str = "0.0.0.0"
    app_port: int = 18000
    frontend_url: str = "http://localhost:3000"
    cors_origins_raw: str = Field(default="", validation_alias="CORS_ORIGINS")
    database_url: str = "mysql+pymysql://rootspread:rootspread@127.0.0.1:3306/rootspread"
    redis_url: str = "redis://127.0.0.1:6379/0"
    jwt_secret: str = "change-me"
    access_token_ttl_minutes: int = 60
    refresh_token_ttl_days: int = 30
    email_verification_ttl_hours: int = 24
    workspace_invitation_ttl_days: int = 7
    resend_from_email: str = "RootSpread <onboarding@resend.dev>"
    resend_api_key: str = ""
    sql_echo: bool = False

    model_config = SettingsConfigDict(
        env_file=(APP_DIR / ".env", REPO_DIR / ".env"),
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",
    )

    @property
    def cors_origins(self) -> list[str]:
        origins = [self.frontend_url]

        if self.cors_origins_raw:
            origins.extend(
                origin.strip() for origin in self.cors_origins_raw.split(",") if origin.strip()
            )

        return list(dict.fromkeys(origins))


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    return Settings()
