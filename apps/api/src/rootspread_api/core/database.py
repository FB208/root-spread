from collections.abc import Generator
from functools import lru_cache

from sqlalchemy import create_engine
from sqlalchemy import inspect, text
from sqlalchemy.engine import Engine
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker

from rootspread_api.core.config import get_settings


class Base(DeclarativeBase):
    pass


@lru_cache(maxsize=1)
def get_engine() -> Engine:
    settings = get_settings()
    connect_args: dict[str, bool] = {}
    engine_kwargs: dict[str, object] = {
        "future": True,
        "echo": settings.sql_echo,
        "connect_args": connect_args,
    }

    if settings.database_url.startswith("sqlite"):
        connect_args["check_same_thread"] = False
    else:
        engine_kwargs["pool_pre_ping"] = settings.database_pool_pre_ping
        engine_kwargs["pool_recycle"] = settings.database_pool_recycle_seconds

    return create_engine(settings.database_url, **engine_kwargs)


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
    upgrade_runtime_schema()


def upgrade_runtime_schema() -> None:
    engine = get_engine()
    inspector = inspect(engine)

    if "task_nodes" not in inspector.get_table_names():
        return

    columns = {column["name"] for column in inspector.get_columns("task_nodes")}
    statements: list[str] = []

    if "meta_revision" not in columns:
        statements.append(
            "ALTER TABLE task_nodes ADD COLUMN meta_revision INTEGER NOT NULL DEFAULT 0"
        )

    if not statements:
        return

    with engine.begin() as connection:
        for statement in statements:
            connection.execute(text(statement))
