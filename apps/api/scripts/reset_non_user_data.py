from __future__ import annotations

import argparse
import sys
from pathlib import Path

from sqlalchemy import text
from sqlalchemy.engine import Connection

SRC_DIR = Path(__file__).resolve().parents[1] / "src"

stdout_reconfigure = getattr(sys.stdout, "reconfigure", None)
if callable(stdout_reconfigure):
    stdout_reconfigure(encoding="utf-8")

stderr_reconfigure = getattr(sys.stderr, "reconfigure", None)
if callable(stderr_reconfigure):
    stderr_reconfigure(encoding="utf-8")

KEEP_TABLES = {"users", "alembic_version"}


def load_app_context():
    if str(SRC_DIR) not in sys.path:
        sys.path.insert(0, str(SRC_DIR))

    import rootspread_api.models.audit  # noqa: F401
    import rootspread_api.models.auth  # noqa: F401
    import rootspread_api.models.milestone  # noqa: F401
    import rootspread_api.models.task  # noqa: F401
    import rootspread_api.models.user  # noqa: F401
    import rootspread_api.models.workspace  # noqa: F401
    from rootspread_api.core.config import get_settings
    from rootspread_api.core.database import Base, get_engine, init_db

    return Base, get_engine, get_settings, init_db


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="重建数据库中除 users 外的业务表。",
    )
    parser.add_argument(
        "--yes",
        action="store_true",
        help="跳过二次确认，直接执行。",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="只显示将被重建的表，不实际执行。",
    )
    return parser.parse_args()


def set_foreign_key_checks(connection: Connection, enabled: bool) -> None:
    dialect = connection.dialect.name

    if dialect == "sqlite":
        connection.exec_driver_sql(f"PRAGMA foreign_keys = {'ON' if enabled else 'OFF'}")
        return

    if dialect in {"mysql", "mariadb"}:
        connection.execute(text(f"SET FOREIGN_KEY_CHECKS = {1 if enabled else 0}"))
        return

    if dialect == "postgresql":
        role = "origin" if enabled else "replica"
        connection.execute(text(f"SET session_replication_role = '{role}'"))


def get_target_tables(base_model):
    create_tables = [
        table for table in base_model.metadata.sorted_tables if table.name not in KEEP_TABLES
    ]
    drop_tables = list(reversed(create_tables))
    return create_tables, drop_tables


def prompt_confirmation(table_names: list[str], database_url: str) -> None:
    print(f"当前数据库: {database_url}")
    print("将重建以下表（删除全部数据并按当前模型重新建表，保留 users）:")
    for name in table_names:
        print(f"- {name}")

    confirmation = input("输入 RESET 继续: ").strip()
    if confirmation != "RESET":
        raise SystemExit("已取消操作。")


def main() -> None:
    args = parse_args()
    base_model, get_engine, get_settings, init_db = load_app_context()
    init_db()
    settings = get_settings()
    create_tables, drop_tables = get_target_tables(base_model)
    table_names = [table.name for table in create_tables]

    if not table_names:
        print("没有需要清空的表。")
        return

    if args.dry_run:
        print(f"当前数据库: {settings.database_url}")
        print("Dry run: 以下表会被重建:")
        for name in table_names:
            print(f"- {name}")
        return

    if not args.yes:
        prompt_confirmation(table_names, settings.database_url)

    engine = get_engine()

    with engine.begin() as connection:
        set_foreign_key_checks(connection, enabled=False)
        try:
            for table in drop_tables:
                table.drop(bind=connection, checkfirst=True)

            for table in create_tables:
                table.create(bind=connection, checkfirst=True)
        finally:
            set_foreign_key_checks(connection, enabled=True)

    print("重建完成。")
    for name in table_names:
        print(f"- {name}")


if __name__ == "__main__":
    main()
