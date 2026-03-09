from collections.abc import Generator
from functools import lru_cache

from sqlalchemy import create_engine
from sqlalchemy.engine import Engine
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker

from rootspread_api.core.config import get_settings


class Base(DeclarativeBase):
    pass


@lru_cache(maxsize=1)
def get_engine() -> Engine:
    settings = get_settings()
    connect_args: dict[str, bool] = {}

    if settings.database_url.startswith("sqlite"):
        connect_args["check_same_thread"] = False

    return create_engine(
        settings.database_url,
        future=True,
        echo=settings.sql_echo,
        connect_args=connect_args,
    )


@lru_cache(maxsize=1)
def get_session_factory() -> sessionmaker[Session]:
    return sessionmaker(
        bind=get_engine(), autoflush=False, autocommit=False, expire_on_commit=False
    )


def get_db() -> Generator[Session, None, None]:
    session = get_session_factory()()
    try:
        yield session
    finally:
        session.close()


def init_db() -> None:
    import rootspread_api.models.audit  # noqa: F401
    import rootspread_api.models.auth  # noqa: F401
    import rootspread_api.models.milestone  # noqa: F401
    import rootspread_api.models.task  # noqa: F401
    import rootspread_api.models.user  # noqa: F401
    import rootspread_api.models.workspace  # noqa: F401

    Base.metadata.create_all(bind=get_engine())
