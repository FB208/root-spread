from fastapi.testclient import TestClient

from .helpers import auth_headers, create_verified_user, create_workspace, get_system_root


def test_task_tree_rules_and_reorder(client: TestClient) -> None:
    owner = create_verified_user(client, "task-owner@rootspread.dev", "Task Owner")
    workspace = create_workspace(client, owner["access_token"], name="Task Engine")
    root = get_system_root(client, owner["access_token"], workspace["id"])

    parent_response = client.post(
        f"/api/v1/workspaces/{workspace['id']}/tasks",
        json={"title": "Build RootSpread MVP", "weight": 100},
        headers=auth_headers(owner["access_token"]),
    )
    assert parent_response.status_code == 201
    parent_task = parent_response.json()
    assert parent_task["parent_id"] == root["id"]
    assert parent_task["node_kind"] == "task"

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
    root_node = task_tree_response.json()["root"]
    assert root_node["children"][0]["status"] == "completed"

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
    assert refreshed_tree.json()["root"]["children"][0]["status"] == "in_progress"

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
    filtered_tree = filtered_response.json()["root"]
    assert filtered_tree["matched_filter"] is False
    assert len(filtered_tree["children"]) == 1
    assert filtered_tree["children"][0]["matched_filter"] is True

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
    assert len(after_delete_response.json()["root"]["children"][0]["children"]) == 2

    delete_root_response = client.delete(
        f"/api/v1/workspaces/{workspace['id']}/tasks/{root['id']}",
        headers=auth_headers(owner["access_token"]),
    )
    assert delete_root_response.status_code == 400


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


def test_system_root_only_allows_title_and_content_updates(client: TestClient) -> None:
    owner = create_verified_user(client, "root-owner@rootspread.dev", "Root Owner")
    workspace = create_workspace(client, owner["access_token"], name="System Root Workspace")
    root = get_system_root(client, owner["access_token"], workspace["id"])

    rename_response = client.patch(
        f"/api/v1/workspaces/{workspace['id']}/tasks/{root['id']}",
        json={"title": "项目总览", "content_markdown": "系统入口"},
        headers=auth_headers(owner["access_token"]),
    )
    assert rename_response.status_code == 200
    assert rename_response.json()["title"] == "项目总览"

    invalid_update_response = client.patch(
        f"/api/v1/workspaces/{workspace['id']}/tasks/{root['id']}",
        json={"weight": 10},
        headers=auth_headers(owner["access_token"]),
    )
    assert invalid_update_response.status_code == 400

    invalid_status_response = client.post(
        f"/api/v1/workspaces/{workspace['id']}/tasks/{root['id']}/status",
        json={"status": "completed"},
        headers=auth_headers(owner["access_token"]),
    )
    assert invalid_status_response.status_code == 400


def test_task_sync_snapshot_changes_and_stream(client: TestClient) -> None:
    owner = create_verified_user(client, "sync-owner@rootspread.dev", "Sync Owner")
    workspace = create_workspace(client, owner["access_token"], name="Sync Workspace")
    root = get_system_root(client, owner["access_token"], workspace["id"])

    snapshot_response = client.get(
        f"/api/v1/workspaces/{workspace['id']}/tasks/snapshot",
        headers=auth_headers(owner["access_token"]),
    )
    assert snapshot_response.status_code == 200
    snapshot_payload = snapshot_response.json()
    assert snapshot_payload["root_id"] == root["id"]
    assert snapshot_payload["tasks"][0]["id"] == root["id"]

    create_response = client.post(
        f"/api/v1/workspaces/{workspace['id']}/tasks/ops",
        json={
            "type": "create_task",
            "parent_id": root["id"],
            "title": "Realtime Task",
            "op_id": "op-create-1",
        },
        headers=auth_headers(owner["access_token"]),
    )
    assert create_response.status_code == 200
    create_changeset = create_response.json()
    assert create_changeset["op_type"] == "create_task"
    assert create_changeset["op_id"] == "op-create-1"
    assert any(task["title"] == "Realtime Task" for task in create_changeset["upserts"])

    changes_response = client.get(
        f"/api/v1/workspaces/{workspace['id']}/tasks/changes?since=0",
        headers=auth_headers(owner["access_token"]),
    )
    assert changes_response.status_code == 200
    changes_payload = changes_response.json()
    assert changes_payload["events"][-1]["op_type"] == "create_task"
    assert changes_payload["events"][-1]["sync_seq"] == create_changeset["sync_seq"]

    with client.websocket_connect(
        f"/api/v1/workspaces/{workspace['id']}/tasks/stream?token={owner['access_token']}&since=0"
    ) as websocket:
        first_message = websocket.receive_json()
        assert first_message["op_type"] == "create_task"
        ready_message = websocket.receive_json()
        assert ready_message["type"] == "ready"
        assert ready_message["sync_seq"] >= create_changeset["sync_seq"]


def test_collab_document_persistence_endpoint(client: TestClient) -> None:
    owner = create_verified_user(client, "collab-owner@rootspread.dev", "Collab Owner")
    workspace = create_workspace(client, owner["access_token"], name="Collab Workspace")
    task_response = client.post(
        f"/api/v1/workspaces/{workspace['id']}/tasks",
        json={"title": "Collaborative Doc"},
        headers=auth_headers(owner["access_token"]),
    )
    assert task_response.status_code == 201
    task = task_response.json()

    document_response = client.get(
        f"/api/v1/workspaces/{workspace['id']}/tasks/{task['id']}/document",
        headers=auth_headers(owner["access_token"]),
    )
    assert document_response.status_code == 200
    assert document_response.json()["content_markdown"] == ""

    persist_response = client.put(
        f"/api/v1/internal/collab/workspaces/{workspace['id']}/tasks/{task['id']}/document",
        json={"content_markdown": "# 协同正文\n\n多人实时编辑"},
        headers={"X-Collab-Secret": "change-me-collab"},
    )
    assert persist_response.status_code == 200

    refreshed_document_response = client.get(
        f"/api/v1/workspaces/{workspace['id']}/tasks/{task['id']}/document",
        headers=auth_headers(owner["access_token"]),
    )
    assert refreshed_document_response.status_code == 200
    assert refreshed_document_response.json()["content_markdown"].startswith("# 协同正文")
