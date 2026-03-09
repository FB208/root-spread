from fastapi.testclient import TestClient


def register_user(
    client: TestClient,
    email: str,
    password: str = "Password123!",
    display_name: str = "Test User",
) -> dict:
    response = client.post(
        "/api/v1/auth/register",
        json={
            "email": email,
            "password": password,
            "display_name": display_name,
        },
    )
    assert response.status_code == 201
    return response.json()


def verify_user(client: TestClient, token: str) -> None:
    response = client.post("/api/v1/auth/verify-email", json={"token": token})
    assert response.status_code == 200


def login_user(client: TestClient, email: str, password: str = "Password123!") -> dict:
    response = client.post(
        "/api/v1/auth/login",
        json={"email": email, "password": password},
    )
    assert response.status_code == 200
    return response.json()


def create_verified_user(
    client: TestClient,
    email: str,
    display_name: str,
    password: str = "Password123!",
) -> dict:
    register_response = register_user(
        client,
        email=email,
        password=password,
        display_name=display_name,
    )
    verify_user(client, register_response["debug_verification_token"])
    return login_user(client, email, password)


def auth_headers(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def create_workspace(client: TestClient, access_token: str, name: str = "Workspace") -> dict:
    response = client.post(
        "/api/v1/workspaces",
        json={"name": name},
        headers=auth_headers(access_token),
    )
    assert response.status_code == 201
    return response.json()
