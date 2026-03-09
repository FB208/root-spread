from collections.abc import Generator

import pytest
from fastapi.testclient import TestClient


@pytest.fixture()
def client(
    monkeypatch: pytest.MonkeyPatch, tmp_path: pytest.TempPathFactory
) -> Generator[TestClient, None, None]:
    database_file = tmp_path / "rootspread-test.db"

    monkeypatch.setenv("APP_ENV", "testing")
    monkeypatch.setenv("DATABASE_URL", f"sqlite:///{database_file.as_posix()}")
    monkeypatch.setenv("JWT_SECRET", "test-secret")
    monkeypatch.setenv("FRONTEND_URL", "http://localhost:3000")
    monkeypatch.setenv("RESEND_API_KEY", "")

    from rootspread_api.core.config import get_settings
    from rootspread_api.core.database import get_engine, get_session_factory

    get_settings.cache_clear()
    get_engine.cache_clear()
    get_session_factory.cache_clear()

    from rootspread_api.main import create_application

    application = create_application()

    with TestClient(application) as test_client:
        yield test_client

    get_session_factory.cache_clear()
    get_engine.cache_clear()
    get_settings.cache_clear()
