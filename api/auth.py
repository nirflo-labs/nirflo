import os
import logging
from pathlib import Path

import httpx
from clerk_backend_api import Clerk
from clerk_backend_api.security.types import AuthenticateRequestOptions
from dotenv import load_dotenv
from fastapi import HTTPException, Request

load_dotenv(Path(__file__).resolve().parent.parent / ".env")

clerk = Clerk(bearer_auth=os.environ["CLERK_SECRET_KEY"])
PARTIES = [p.strip() for p in os.environ["CLERK_AUTHORIZED_PARTIES"].split(",") if p.strip()]


def current_clerk_id(request: Request) -> str:
    probe = httpx.Request("GET", "http://localhost", headers={"Authorization": request.headers.get("authorization", "")})
    state = clerk.authenticate_request(probe, AuthenticateRequestOptions(authorized_parties=PARTIES))
    if not state.is_signed_in:
        log.warning("Autentikasi ditolak: reason=%s has_token=%s", getattr(state, "reason", None), bool(request.headers.get("authorization")))
        raise HTTPException(status_code=401, detail="Belum login")
    return state.payload["sub"]

log = logging.getLogger(__name__)


def clerk_display_name(clerk_id: str) -> str | None:
    try:
        u = clerk.users.get(user_id=clerk_id)
    except Exception as exc:
        log.warning("Gagal mengambil profil Clerk: %s", exc)
        return None
    full = " ".join(p for p in (u.first_name, u.last_name) if p).strip()
    if full:
        return full
    if u.username:
        return u.username
    email = next((e.email_address for e in (u.email_addresses or []) if e.id == u.primary_email_address_id), None)
    return email.split("@")[0] if email else None