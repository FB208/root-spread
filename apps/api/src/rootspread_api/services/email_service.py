import logging
from urllib.parse import urlencode

import resend

from rootspread_api.core.config import get_settings

logger = logging.getLogger(__name__)


def _send_email(to: str, subject: str, html: str) -> None:
    settings = get_settings()

    if not settings.resend_api_key:
        logger.info("Resend API key is not configured. Skipping email to %s.", to)
        return

    try:
        resend.api_key = settings.resend_api_key
        resend.Emails.send(
            {
                "from": settings.resend_from_email,
                "to": [to],
                "subject": subject,
                "html": html,
            }
        )
    except Exception:  # pragma: no cover - depends on external provider
        logger.exception("Failed to send email through Resend.")


def send_verification_email(email: str, display_name: str, token: str) -> None:
    settings = get_settings()
    query = urlencode({"token": token})
    verify_url = f"{settings.frontend_url}/verify-email?{query}"
    html = (
        f"<p>Hi {display_name},</p>"
        "<p>Welcome to RootSpread. Use the link below to verify your email:</p>"
        f'<p><a href="{verify_url}">{verify_url}</a></p>'
    )
    _send_email(email, "Verify your RootSpread account", html)


def send_workspace_invitation_email(email: str, workspace_name: str, token: str) -> None:
    settings = get_settings()
    query = urlencode({"token": token})
    invite_url = f"{settings.frontend_url}/invitations/accept?{query}"
    html = (
        f"<p>You were invited to join the workspace <strong>{workspace_name}</strong>.</p>"
        f'<p>Open this link to accept the invitation: <a href="{invite_url}">{invite_url}</a></p>'
    )
    _send_email(email, f"Join {workspace_name} on RootSpread", html)
