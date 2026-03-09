from fastapi.testclient import TestClient

from .helpers import auth_headers, create_verified_user, create_workspace


def test_task_tree_rules_and_reorder(client: TestClient) -> None:
    owner = create_verified_user(client, "task-owner@rootspread.dev", "Task Owner")
    workspace = create_workspace(client, owner["access_token"], name="Task Engine")

    parent_response = client.post(
        f"/api/v1/workspaces/{workspace['id']}/tasks",
        json={"title": "Build RootSpread MVP", "weight": 100},
        headers=auth_headers(owner["access_token"]),
    )
    assert parent_response.status_code == 201
    parent_task = parent_response.json()

    child_a_response = client.post(
        f"/api/v1/workspaces/{workspace['id']}/tasks",
        json={"parent_id": parent_task["id"], "title": "Auth API"},
        headers=auth_headers(owner["access_token"]),
    )
    assert child_a_response.status_code == 201
    child_a = child_a_response.json()

    child_b_response = client.post(
        f"/api/v1/workspaces/{workspace['id']}/tasks",
        json={"parent_id": parent_task["id"], "title": "Workspace API"},
        headers=auth_headers(owner["access_token"]),
    )
    assert child_b_response.status_code == 201
    child_b = child_b_response.json()

    parent_complete_response = client.post(
        f"/api/v1/workspaces/{workspace['id']}/tasks/{parent_task['id']}/status",
        json={"status": "completed"},
        headers=auth_headers(owner["access_token"]),
    )
    assert parent_complete_response.status_code == 400

    for task_id in [child_a["id"], child_b["id"]]:
        response = client.post(
            f"/api/v1/workspaces/{workspace['id']}/tasks/{task_id}/status",
            json={"status": "completed"},
            headers=auth_headers(owner["access_token"]),
        )
        assert response.status_code == 200

    task_tree_response = client.get(
        f"/api/v1/workspaces/{workspace['id']}/tasks/tree",
        headers=auth_headers(owner["access_token"]),
    )
    assert task_tree_response.status_code == 200
    tree = task_tree_response.json()
    assert tree[0]["status"] == "completed"

    new_child_response = client.post(
        f"/api/v1/workspaces/{workspace['id']}/tasks",
        json={"parent_id": parent_task["id"], "title": "Task API"},
        headers=auth_headers(owner["access_token"]),
    )
    assert new_child_response.status_code == 201
    new_child = new_child_response.json()

    refreshed_tree = client.get(
        f"/api/v1/workspaces/{workspace['id']}/tasks/tree",
        headers=auth_headers(owner["access_token"]),
    )
    assert refreshed_tree.status_code == 200
    assert refreshed_tree.json()[0]["status"] == "in_progress"

    reorder_response = client.post(
        f"/api/v1/workspaces/{workspace['id']}/tasks/reorder",
        json={
            "parent_id": parent_task["id"],
            "task_ids": [new_child["id"], child_b["id"], child_a["id"]],
        },
        headers=auth_headers(owner["access_token"]),
    )
    assert reorder_response.status_code == 200

    filtered_response = client.get(
        f"/api/v1/workspaces/{workspace['id']}/tasks/tree?status=in_progress",
        headers=auth_headers(owner["access_token"]),
    )
    assert filtered_response.status_code == 200
    filtered_tree = filtered_response.json()
    assert filtered_tree[0]["matched_filter"] is True
    assert len(filtered_tree[0]["children"]) == 1
    assert filtered_tree[0]["children"][0]["matched_filter"] is True

    delete_response = client.delete(
        f"/api/v1/workspaces/{workspace['id']}/tasks/{new_child['id']}",
        headers=auth_headers(owner["access_token"]),
    )
    assert delete_response.status_code == 200

    after_delete_response = client.get(
        f"/api/v1/workspaces/{workspace['id']}/tasks/tree",
        headers=auth_headers(owner["access_token"]),
    )
    assert after_delete_response.status_code == 200
    assert len(after_delete_response.json()[0]["children"]) == 2


def test_pending_review_can_be_rejected_without_remark(client: TestClient) -> None:
    owner = create_verified_user(client, "review-owner@rootspread.dev", "Review Owner")
    member = create_verified_user(client, "review-member@rootspread.dev", "Review Member")
    workspace = create_workspace(client, owner["access_token"], name="Task Engine")

    invite_response = client.post(
        f"/api/v1/workspaces/{workspace['id']}/invitations",
        json={"email": "review-member@rootspread.dev", "role": "member"},
        headers=auth_headers(owner["access_token"]),
    )
    assert invite_response.status_code == 201

    accept_response = client.post(
        "/api/v1/workspaces/invitations/accept",
        json={"token": invite_response.json()["debug_invitation_token"]},
        headers=auth_headers(member["access_token"]),
    )
    assert accept_response.status_code == 200

    task_response = client.post(
        f"/api/v1/workspaces/{workspace['id']}/tasks",
        json={"title": "Need review"},
        headers=auth_headers(member["access_token"]),
    )
    assert task_response.status_code == 201
    task = task_response.json()

    pending_response = client.post(
        f"/api/v1/workspaces/{workspace['id']}/tasks/{task['id']}/status",
        json={"status": "pending_review"},
        headers=auth_headers(member["access_token"]),
    )
    assert pending_response.status_code == 200

    reject_response = client.post(
        f"/api/v1/workspaces/{workspace['id']}/tasks/{task['id']}/status",
        json={"status": "in_progress"},
        headers=auth_headers(owner["access_token"]),
    )
    assert reject_response.status_code == 200

    transitions_response = client.get(
        f"/api/v1/workspaces/{workspace['id']}/tasks/{task['id']}/transitions",
        headers=auth_headers(owner["access_token"]),
    )
    assert transitions_response.status_code == 200
    transitions = transitions_response.json()
    assert transitions[0]["to_status"] == "in_progress"
    assert transitions[0]["remark"] is None


def test_bulk_task_actions(client: TestClient) -> None:
    owner = create_verified_user(client, "bulk-owner@rootspread.dev", "Bulk Owner")
    workspace = create_workspace(client, owner["access_token"], name="Task Engine")

    first_task = client.post(
        f"/api/v1/workspaces/{workspace['id']}/tasks",
        json={"title": "Task A"},
        headers=auth_headers(owner["access_token"]),
    ).json()
    second_task = client.post(
        f"/api/v1/workspaces/{workspace['id']}/tasks",
        json={"title": "Task B"},
        headers=auth_headers(owner["access_token"]),
    ).json()

    bulk_status_response = client.post(
        f"/api/v1/workspaces/{workspace['id']}/tasks/bulk-status",
        json={
            "task_ids": [first_task["id"], second_task["id"]],
            "status": "pending_review",
        },
        headers=auth_headers(owner["access_token"]),
    )
    assert bulk_status_response.status_code == 200

    listing_response = client.get(
        f"/api/v1/workspaces/{workspace['id']}/tasks",
        headers=auth_headers(owner["access_token"]),
    )
    assert listing_response.status_code == 200
    assert all(task["status"] == "pending_review" for task in listing_response.json())

    bulk_delete_response = client.post(
        f"/api/v1/workspaces/{workspace['id']}/tasks/bulk-delete",
        json={"task_ids": [first_task["id"], second_task["id"]]},
        headers=auth_headers(owner["access_token"]),
    )
    assert bulk_delete_response.status_code == 200

    empty_response = client.get(
        f"/api/v1/workspaces/{workspace['id']}/tasks",
        headers=auth_headers(owner["access_token"]),
    )
    assert empty_response.status_code == 200
    assert empty_response.json() == []
