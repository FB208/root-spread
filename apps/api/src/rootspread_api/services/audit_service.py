from sqlalchemy.orm import Session

from rootspread_api.models.audit import AuditLog


def log_audit_event(
    session: Session,
    *,
    workspace_id: str,
    actor_user_id: str | None,
    entity_type: str,
    entity_id: str | None,
    action: str,
    message: str,
    metadata_json: dict | None = None,
) -> None:
    session.add(
        AuditLog(
            workspace_id=workspace_id,
            actor_user_id=actor_user_id,
            entity_type=entity_type,
            entity_id=entity_id,
            action=action,
            message=message,
            metadata_json=metadata_json,
        )
    )
