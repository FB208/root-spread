from fastapi.testclient import TestClient

from .helpers import login_user, register_user, verify_user


def test_register_verify_and_login_flow(client: TestClient) -> None:
    register_payload = register_user(client, "owner@example.com", display_name="Owner")
    verification_token = register_payload["debug_verification_token"]
    assert verification_token

    login_before_verify = client.post(
        "/api/v1/auth/login",
        json={"email": "owner@example.com", "password": "Password123!"},
    )
    assert login_before_verify.status_code == 403

    verify_user(client, verification_token)

    login_payload = login_user(client, "owner@example.com")
    assert login_payload["access_token"]
    assert login_payload["refresh_token"]

    me_response = client.get(
        "/api/v1/auth/me",
        headers={"Authorization": f"Bearer {login_payload['access_token']}"},
    )
    assert me_response.status_code == 200
    assert me_response.json()["email"] == "owner@example.com"


def test_refresh_and_logout_flow(client: TestClient) -> None:
    register_payload = register_user(client, "refresh@example.com", display_name="Refresh")
    verify_user(client, register_payload["debug_verification_token"])
    login_payload = login_user(client, "refresh@example.com")

    refresh_response = client.post(
        "/api/v1/auth/refresh",
        json={"refresh_token": login_payload["refresh_token"]},
    )
    assert refresh_response.status_code == 200
    refreshed = refresh_response.json()
    assert refreshed["refresh_token"] != login_payload["refresh_token"]

    logout_response = client.post(
        "/api/v1/auth/logout",
        json={"refresh_token": refreshed["refresh_token"]},
    )
    assert logout_response.status_code == 200

    invalid_refresh = client.post(
        "/api/v1/auth/refresh",
        json={"refresh_token": refreshed["refresh_token"]},
    )
    assert invalid_refresh.status_code == 401
