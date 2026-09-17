from datetime import datetime, timedelta, timezone
from types import SimpleNamespace

import jwt
import pytest
from cryptography.hazmat.primitives.asymmetric import rsa

from app import config, security
from app.db import transaction


@pytest.fixture
def signed_identity(monkeypatch):
    private = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    monkeypatch.setattr(config, "DEMO", False)
    monkeypatch.setattr(config, "ISSUER", "https://identity.example.test")
    monkeypatch.setattr(config, "PARTIES", {"https://time.pathwaybook.com"})
    monkeypatch.setattr(
        security,
        "jwks",
        lambda: SimpleNamespace(
            get_signing_key_from_jwt=lambda token: SimpleNamespace(
                key=private.public_key()
            )
        ),
    )

    def make(**overrides):
        claims = {
            "iss": config.ISSUER,
            "sub": "user_test",
            "sid": "session_test",
            "azp": "https://time.pathwaybook.com",
            "iat": datetime.now(timezone.utc),
            "exp": datetime.now(timezone.utc) + timedelta(minutes=1),
        }
        claims.update(overrides)
        return {
            "authorization": "Bearer " + jwt.encode(claims, private, algorithm="RS256")
        }

    return make


def profile(monkeypatch, email, verified=True):
    data = {
        "primary_email_address_id": "email_1",
        "email_addresses": [
            {
                "id": "email_1",
                "email_address": email,
                "verification": {"status": "verified" if verified else "unverified"},
            }
        ],
    }
    monkeypatch.setattr(
        security.httpx,
        "get",
        lambda *args, **kwargs: SimpleNamespace(
            raise_for_status=lambda: None, json=lambda: data
        ),
    )


def test_verified_enrolled_email_binds_once(client, signed_identity, monkeypatch):
    profile(monkeypatch, "user1001@pathwaybook.com")
    response = client.get("/v1/me", headers=signed_identity())
    assert response.status_code == 200
    assert response.json()["employee_code"] == "1001"
    # A later primary-email change cannot transfer this stable subject to another person.
    profile(monkeypatch, "user1003@pathwaybook.com")
    assert (
        client.get("/v1/me", headers=signed_identity()).json()["employee_code"]
        == "1001"
    )
    with transaction() as conn:
        assert (
            conn.execute(
                "SELECT count(*) n FROM timeclock.audit WHERE action='identity.bound'"
            ).fetchone()["n"]
            == 1
        )


@pytest.mark.parametrize(
    "email,verified",
    [
        ("unlisted@pathwaybook.com", True),
        ("user1001@pathwaybook.com", False),
        ("user1001@evil.test", True),
    ],
)
def test_unenrolled_or_unverified_email_denied(
    client, signed_identity, monkeypatch, email, verified
):
    profile(monkeypatch, email, verified)
    assert client.get("/v1/me", headers=signed_identity()).status_code == 403


@pytest.mark.parametrize(
    "overrides",
    [{"iss": "https://wrong.test"}, {"azp": "https://evil.test"}, {"exp": 0}],
)
def test_bad_tokens_denied(client, signed_identity, overrides):
    assert client.get("/v1/me", headers=signed_identity(**overrides)).status_code == 401


def test_demo_header_is_ignored_in_real_mode(client, signed_identity):
    assert client.get("/v1/me", headers={"x-demo-user": "1002"}).status_code == 401
    assert client.post("/v1/kiosk/demo").status_code == 404


def test_cannot_rebind_an_enrolled_identity(client, signed_identity, monkeypatch):
    profile(monkeypatch, "user1001@pathwaybook.com")
    assert client.get("/v1/me", headers=signed_identity()).status_code == 200
    assert (
        client.get("/v1/me", headers=signed_identity(sub="someone_else")).status_code
        == 403
    )
