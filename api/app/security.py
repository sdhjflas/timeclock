import hashlib
import secrets
from functools import lru_cache

import httpx
import jwt
from argon2 import PasswordHasher
from argon2.exceptions import VerificationError
from fastapi import HTTPException, Request

from . import config
from .db import audit, transaction

hasher = PasswordHasher()
DUMMY_HASH = hasher.hash("not-a-real-pin")


def digest(value):
    return hashlib.sha256(value.encode()).hexdigest()


def token():
    return secrets.token_urlsafe(32)


def check_pin(encoded, pin):
    try:
        return hasher.verify(encoded, pin)
    except VerificationError:
        return False


def proxy(request: Request):
    if not secrets.compare_digest(
        request.headers.get("x-proxy-secret", ""), config.PROXY_SECRET
    ):
        raise HTTPException(403, "Untrusted gateway")


@lru_cache
def jwks():
    return jwt.PyJWKClient(config.ISSUER + "/.well-known/jwks.json")


def identity(request):
    if config.DEMO:
        code = request.headers.get("x-demo-user", "1001")
        if code not in {"1001", "1002", "1003"}:
            raise HTTPException(401, "Invalid demo identity")
        return ("demo", code, None)
    raw = request.headers.get("authorization", "")
    if not raw.startswith("Bearer "):
        raise HTTPException(401, "Please sign in with your Pathway Google account")
    try:
        value = raw[7:]
        claims = jwt.decode(
            value,
            jwks().get_signing_key_from_jwt(value).key,
            algorithms=["RS256"],
            issuer=config.ISSUER,
            options={"verify_aud": False, "require": ["exp", "iat", "sub", "sid"]},
        )
        if claims.get("azp") not in config.PARTIES:
            raise HTTPException(401, "Unapproved sign-in origin")
        return (config.ISSUER, claims["sub"], claims)
    except jwt.PyJWTError:
        raise HTTPException(401, "Invalid or expired sign-in") from None


def user(request: Request):
    proxy(request)
    issuer, subject, _ = identity(request)
    with transaction() as conn:
        if config.DEMO:
            row = conn.execute(
                "SELECT * FROM timeclock.employees WHERE employee_code=%s", (subject,)
            ).fetchone()
        else:
            row = conn.execute(
                "SELECT * FROM timeclock.employees WHERE identity_issuer=%s AND identity_subject=%s",
                (issuer, subject),
            ).fetchone()
            if not row:
                # Resolve verified primary email from Clerk, never browser input or user metadata.
                try:
                    response = httpx.get(
                        f"https://api.clerk.com/v1/users/{subject}",
                        headers={"Authorization": f"Bearer {config.CLERK_SECRET}"},
                        timeout=10,
                    )
                    response.raise_for_status()
                    profile = response.json()
                except (httpx.HTTPError, ValueError):
                    raise HTTPException(
                        503, "Identity verification unavailable; please retry"
                    ) from None
                emails = [
                    e["email_address"].lower()
                    for e in profile.get("email_addresses", [])
                    if e["id"] == profile.get("primary_email_address_id")
                    and e.get("verification", {}).get("status") == "verified"
                ]
                if not emails or emails[0].rsplit("@", 1)[-1] not in config.DOMAINS:
                    raise HTTPException(403, "A verified Pathway email is required")
                row = conn.execute(
                    "SELECT * FROM timeclock.employees WHERE email=%s FOR UPDATE",
                    (emails[0],),
                ).fetchone()
                if row and row["active"] and row["identity_subject"] is None:
                    conn.execute(
                        "UPDATE timeclock.employees SET identity_issuer=%s, identity_subject=%s WHERE id=%s",
                        (issuer, subject, row["id"]),
                    )
                    audit(conn, row["id"], "identity.bound", row["id"])
                elif not (
                    row
                    and row["active"]
                    and row["identity_issuer"] == issuer
                    and row["identity_subject"] == subject
                ):
                    raise HTTPException(
                        403, "Your account has not been enrolled; contact your manager"
                    )
        if not row or not row["active"]:
            raise HTTPException(403, "Your employee account is not active")
        return row


def manager(request: Request):
    row = user(request)
    if not row["manager"]:
        raise HTTPException(403, "Time manager access required")
    return row
