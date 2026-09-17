import os
import uuid

os.environ["APP_ENV"] = "test"
os.environ["DEMO_MODE"] = "true"
os.environ["PROXY_SECRET"] = "test-proxy-secret"
os.environ["ALLOWED_EMAIL_DOMAINS"] = "pathwaybook.com"

import psycopg
import pytest
from fastapi.testclient import TestClient
from psycopg import sql
from psycopg.conninfo import make_conninfo

from app import config
from app.db import pool, transaction
from app.main import app
from app.migrate import migrate
from app.security import hasher


@pytest.fixture(scope="session", autouse=True)
def database():
    # Create a new throwaway database; never truncate the configured application DB.
    admin_url = os.getenv(
        "TEST_DATABASE_ADMIN_URL",
        "postgresql://timeclock:local-only@127.0.0.1:5548/postgres",
    )
    name = "timeclock_test_" + uuid.uuid4().hex[:12]
    with psycopg.connect(admin_url, autocommit=True) as conn:
        conn.execute(sql.SQL("CREATE DATABASE {}").format(sql.Identifier(name)))
    config.DATABASE_URL = make_conninfo(admin_url, dbname=name)
    migrate()
    yield
    pool().close()
    pool.cache_clear()
    with psycopg.connect(admin_url, autocommit=True) as conn:
        conn.execute(
            sql.SQL("DROP DATABASE {} WITH (FORCE)").format(sql.Identifier(name))
        )


@pytest.fixture(autouse=True)
def clean():
    with transaction() as conn:
        conn.execute(
            "TRUNCATE timeclock.employees, timeclock.terminals, timeclock.shifts, timeclock.kiosk_sessions, timeclock.punch_events, timeclock.correction_requests, timeclock.adjustments, timeclock.audit CASCADE"
        )
        encoded = hasher.hash("246810")
        for code, manager in [("1001", False), ("1002", True), ("1003", False)]:
            conn.execute(
                "INSERT INTO timeclock.employees(employee_code,name,email,pin_hash,manager) VALUES(%s,%s,%s,%s,%s)",
                (
                    code,
                    f"Employee {code}",
                    f"user{code}@pathwaybook.com",
                    encoded,
                    manager,
                ),
            )


@pytest.fixture
def client():
    # Session lifespan closes the pool, so use the client without context for each test.
    return TestClient(app, headers={"x-proxy-secret": config.PROXY_SECRET})


@pytest.fixture
def manager_headers():
    return {"x-demo-user": "1002"}


@pytest.fixture
def station(client):
    response = client.post("/v1/kiosk/demo")
    return {"x-terminal-token": response.json()["terminal_token"]}


def login(client, station, code="1001"):
    response = client.post(
        "/v1/kiosk/verify",
        headers=station,
        json={"employee_code": code, "pin": "246810"},
    )
    assert response.status_code == 200, response.text
    return {
        **station,
        "x-kiosk-session": response.json()["session_token"],
    }, response.json()["action"]
