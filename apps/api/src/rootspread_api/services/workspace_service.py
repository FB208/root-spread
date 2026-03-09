import re

from sqlalchemy import select
from sqlalchemy.orm import Session

from rootspread_api.models.workspace import Workspace

SLUG_PATTERN = re.compile(r"[^a-z0-9]+")


def slugify(value: str) -> str:
    slug = SLUG_PATTERN.sub("-", value.lower()).strip("-")
    return slug or "workspace"


def ensure_unique_workspace_slug(session: Session, value: str) -> str:
    base_slug = slugify(value)
    slug = base_slug
    suffix = 2

    while session.scalar(select(Workspace.id).where(Workspace.slug == slug)):
        slug = f"{base_slug}-{suffix}"
        suffix += 1

    return slug
