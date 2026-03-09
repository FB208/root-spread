from fastapi.testclient import TestClient

from .helpers import auth_headers, create_verified_user


def test_workspace_creation_invitation_and_acceptance(client: TestClient) -> None:
    owner = create_verified_user(client, "owner@rootspread.dev", "Owner")

    create_workspace_response = client.post(
        "/api/v1/workspaces",
        json={"name": "RootSpread Core"},
        headers=auth_headers(owner["access_token"]),
    )
    assert create_workspace_response.status_code == 201
    workspace = create_workspace_response.json()

    workspace_list_response = client.get(
        "/api/v1/workspaces",
        headers=auth_headers(owner["access_token"]),
    )
    assert workspace_list_response.status_code == 200
    assert workspace_list_response.json()[0]["slug"] == "rootspread-core"

    invite_response = client.post(
        f"/api/v1/workspaces/{workspace['id']}/invitations",
        json={"email": "member@rootspread.dev", "role": "member"},
        headers=auth_headers(owner["access_token"]),
    )
    assert invite_response.status_code == 201
    invitation_token = invite_response.json()["debug_invitation_token"]
    assert invitation_token

    invitation_list_response = client.get(
        f"/api/v1/workspaces/{workspace['id']}/invitations",
        headers=auth_headers(owner["access_token"]),
    )
    assert invitation_list_response.status_code == 200
    assert invitation_list_response.json()[0]["email"] == "member@rootspread.dev"

    member = create_verified_user(client, "member@rootspread.dev", "Member")

    pending_response = client.get(
        "/api/v1/workspaces/invitations/pending",
        headers=auth_headers(member["access_token"]),
    )
    assert pending_response.status_code == 200
    assert pending_response.json()[0]["workspace_id"] == workspace["id"]

    accept_response = client.post(
        "/api/v1/workspaces/invitations/accept",
        json={"token": invitation_token},
        headers=auth_headers(member["access_token"]),
    )
    assert accept_response.status_code == 200

    member_workspaces_response = client.get(
        "/api/v1/workspaces",
        headers=auth_headers(member["access_token"]),
    )
    assert member_workspaces_response.status_code == 200
    assert member_workspaces_response.json()[0]["role"] == "member"

    members_response = client.get(
        f"/api/v1/workspaces/{workspace['id']}/members",
        headers=auth_headers(owner["access_token"]),
    )
    assert members_response.status_code == 200
    assert len(members_response.json()) == 2

    target_member = next(
        member
        for member in members_response.json()
        if member["user"]["email"] == "member@rootspread.dev"
    )
    role_update_response = client.patch(
        f"/api/v1/workspaces/{workspace['id']}/members/{target_member['id']}",
        json={"role": "admin"},
        headers=auth_headers(owner["access_token"]),
    )
    assert role_update_response.status_code == 200
    assert role_update_response.json()["role"] == "admin"

    second_invite_response = client.post(
        f"/api/v1/workspaces/{workspace['id']}/invitations",
        json={"email": "ghost@rootspread.dev", "role": "member"},
        headers=auth_headers(owner["access_token"]),
    )
    assert second_invite_response.status_code == 201
    second_invitation_id = second_invite_response.json()["invitation"]["id"]

    revoke_response = client.delete(
        f"/api/v1/workspaces/{workspace['id']}/invitations/{second_invitation_id}",
        headers=auth_headers(owner["access_token"]),
    )
    assert revoke_response.status_code == 200

    remove_member_response = client.delete(
        f"/api/v1/workspaces/{workspace['id']}/members/{target_member['id']}",
        headers=auth_headers(owner["access_token"]),
    )
    assert remove_member_response.status_code == 200

    refreshed_members_response = client.get(
        f"/api/v1/workspaces/{workspace['id']}/members",
        headers=auth_headers(owner["access_token"]),
    )
    assert refreshed_members_response.status_code == 200
    assert len(refreshed_members_response.json()) == 1
