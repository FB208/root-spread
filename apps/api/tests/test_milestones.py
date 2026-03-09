from datetime import timedelta

from fastapi.testclient import TestClient

from rootspread_api.core.time import utc_now
from .helpers import auth_headers, create_verified_user, create_workspace


def test_create_milestone_and_archive_finished_tasks(client: TestClient) -> None:
    owner = create_verified_user(client, "milestone-owner@rootspread.dev", "Milestone Owner")
    workspace = create_workspace(client, owner["access_token"], name="Milestone Workspace")

    parent = client.post(
        f"/api/v1/workspaces/{workspace['id']}/tasks",
        json={"title": "Release RootSpread"},
        headers=auth_headers(owner["access_token"]),
    ).json()

    completed_child = client.post(
        f"/api/v1/workspaces/{workspace['id']}/tasks",
        json={"parent_id": parent["id"], "title": "Finish auth"},
        headers=auth_headers(owner["access_token"]),
    ).json()
    terminated_child = client.post(
        f"/api/v1/workspaces/{workspace['id']}/tasks",
        json={"parent_id": parent["id"], "title": "Discard old branch"},
        headers=auth_headers(owner["access_token"]),
    ).json()
    active_child = client.post(
        f"/api/v1/workspaces/{workspace['id']}/tasks",
        json={"parent_id": parent["id"], "title": "Build dashboard"},
        headers=auth_headers(owner["access_token"]),
    ).json()

    complete_response = client.post(
        f"/api/v1/workspaces/{workspace['id']}/tasks/{completed_child['id']}/status",
        json={"status": "completed"},
        headers=auth_headers(owner["access_token"]),
    )
    assert complete_response.status_code == 200

    terminate_response = client.post(
        f"/api/v1/workspaces/{workspace['id']}/tasks/{terminated_child['id']}/status",
        json={"status": "terminated"},
        headers=auth_headers(owner["access_token"]),
    )
    assert terminate_response.status_code == 200

    milestone_response = client.post(
        f"/api/v1/workspaces/{workspace['id']}/milestones",
        json={
            "name": "Sprint Alpha",
            "description": "归档阶段一任务",
            "target_at": (utc_now() + timedelta(days=1)).isoformat(),
        },
        headers=auth_headers(owner["access_token"]),
    )
    assert milestone_response.status_code == 201
    milestone = milestone_response.json()
    assert milestone["archived_task_count"] == 2

    active_tasks_response = client.get(
        f"/api/v1/workspaces/{workspace['id']}/tasks",
        headers=auth_headers(owner["access_token"]),
    )
    assert active_tasks_response.status_code == 200
    active_titles = {task["title"] for task in active_tasks_response.json()}
    assert active_titles == {"Release RootSpread", "Build dashboard"}

    active_tree_response = client.get(
        f"/api/v1/workspaces/{workspace['id']}/tasks/tree",
        headers=auth_headers(owner["access_token"]),
    )
    assert active_tree_response.status_code == 200
    active_tree = active_tree_response.json()
    assert len(active_tree) == 1
    assert len(active_tree[0]["children"]) == 1
    assert active_tree[0]["children"][0]["id"] == active_child["id"]

    milestones_response = client.get(
        f"/api/v1/workspaces/{workspace['id']}/milestones",
        headers=auth_headers(owner["access_token"]),
    )
    assert milestones_response.status_code == 200
    assert milestones_response.json()[0]["id"] == milestone["id"]

    milestone_tree_response = client.get(
        f"/api/v1/workspaces/{workspace['id']}/milestones/{milestone['id']}/tree",
        headers=auth_headers(owner["access_token"]),
    )
    assert milestone_tree_response.status_code == 200
    milestone_tree = milestone_tree_response.json()["tree"]
    assert milestone_tree[0]["matched_filter"] is False
    assert len(milestone_tree[0]["children"]) == 2

    filtered_snapshot_response = client.get(
        f"/api/v1/workspaces/{workspace['id']}/milestones/{milestone['id']}/tree?status=completed",
        headers=auth_headers(owner["access_token"]),
    )
    assert filtered_snapshot_response.status_code == 200
    filtered_tree = filtered_snapshot_response.json()["tree"]
    assert len(filtered_tree[0]["children"]) == 1
    assert filtered_tree[0]["children"][0]["status"] == "completed"

    stats_response = client.get(
        f"/api/v1/workspaces/{workspace['id']}/stats",
        headers=auth_headers(owner["access_token"]),
    )
    assert stats_response.status_code == 200
    stats_payload = stats_response.json()
    assert stats_payload["archived_task_count"] == 2
    assert stats_payload["milestone_count"] == 1

    audit_response = client.get(
        f"/api/v1/workspaces/{workspace['id']}/audit-logs",
        headers=auth_headers(owner["access_token"]),
    )
    assert audit_response.status_code == 200
    assert any(log["action"] == "milestone_created" for log in audit_response.json())
