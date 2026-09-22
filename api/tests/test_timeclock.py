from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
from uuid import uuid4

import psycopg
import pytest

from app import config
from app.db import transaction
from app.hours import daily_totals
from conftest import login


def test_clock_cycle_and_idempotent_retry(client, station):
    headers, action = login(client, station)
    body = {"action": action, "request_id": str(uuid4())}
    first = client.post("/v1/kiosk/punch", headers=headers, json=body)
    assert first.status_code == 200
    assert (
        first.json()
        == client.post("/v1/kiosk/punch", headers=headers, json=body).json()
    )
    assert (
        client.post(
            "/v1/kiosk/punch",
            headers=headers,
            json={**body, "request_id": str(uuid4())},
        ).status_code
        == 409
    )
    assert client.get("/v1/me/hours").json()["open_shift"]
    headers, action = login(client, station)
    assert action == "out"
    assert (
        client.post(
            "/v1/kiosk/punch",
            headers=headers,
            json={"action": action, "request_id": str(uuid4())},
        ).status_code
        == 200
    )
    assert client.get("/v1/me/hours").json()["open_shift"] is None
    with transaction() as conn:
        assert (
            conn.execute("SELECT count(*) n FROM timeclock.punch_events").fetchone()[
                "n"
            ]
            == 2
        )


def test_concurrent_clock_ins_only_create_one_shift(client, station):
    second_station = {
        "x-terminal-token": client.post("/v1/kiosk/demo").json()["terminal_token"]
    }
    sessions = [login(client, station)[0], login(client, second_station)[0]]

    def punch(headers):
        return client.post(
            "/v1/kiosk/punch",
            headers=headers,
            json={"action": "in", "request_id": str(uuid4())},
        ).status_code

    with ThreadPoolExecutor(2) as executor:
        assert sorted(executor.map(punch, sessions)) == [200, 409]
    with transaction() as conn:
        assert (
            conn.execute("SELECT count(*) n FROM timeclock.shifts").fetchone()["n"] == 1
        )


def test_concurrent_same_request_returns_same_receipt(client, station):
    headers, action = login(client, station)
    body = {"action": action, "request_id": str(uuid4())}
    with ThreadPoolExecutor(2) as executor:
        results = list(
            executor.map(
                lambda _: client.post("/v1/kiosk/punch", headers=headers, json=body),
                range(2),
            )
        )
    assert [r.status_code for r in results] == [200, 200]
    assert results[0].json() == results[1].json()


def test_no_station_no_punch_and_no_client_timestamp(client, station):
    assert (
        client.post(
            "/v1/kiosk/verify", json={"employee_code": "1001", "pin": "246810"}
        ).status_code
        == 403
    )
    headers, action = login(client, station)
    assert (
        client.post(
            "/v1/kiosk/punch",
            headers=headers,
            json={
                "action": action,
                "request_id": str(uuid4()),
                "occurred_at": "2020-01-01",
            },
        ).status_code
        == 422
    )


def test_revoked_station_and_expired_session(client, station, manager_headers):
    headers, action = login(client, station)
    with transaction() as conn:
        conn.execute(
            "UPDATE timeclock.kiosk_sessions SET expires_at=clock_timestamp()-interval '1 second'"
        )
    assert (
        client.post(
            "/v1/kiosk/punch",
            headers=headers,
            json={"action": action, "request_id": str(uuid4())},
        ).status_code
        == 401
    )
    device = client.get("/v1/kiosk/station", headers=station).json()
    assert (
        client.delete(
            f"/v1/admin/terminals/{device['id']}", headers=manager_headers
        ).status_code
        == 200
    )
    assert client.get("/v1/kiosk/station", headers=station).status_code == 403


def test_stale_kiosk_sessions_are_purged_on_next_verify(client, station):
    login(client, station)
    with transaction() as conn:
        conn.execute(
            "UPDATE timeclock.kiosk_sessions SET expires_at=clock_timestamp()-interval '2 days'"
        )
    login(client, station, "1003")
    with transaction() as conn:
        assert (
            conn.execute("SELECT count(*) n FROM timeclock.kiosk_sessions").fetchone()[
                "n"
            ]
            == 1
        )


def test_pin_lockout_persists_and_blocks_correct_pin(client, station):
    for _ in range(5):
        assert (
            client.post(
                "/v1/kiosk/verify",
                headers=station,
                json={"employee_code": "1001", "pin": "000000"},
            ).status_code
            == 401
        )
    assert (
        client.post(
            "/v1/kiosk/verify",
            headers=station,
            json={"employee_code": "1001", "pin": "246810"},
        ).status_code
        == 401
    )
    with transaction() as conn:
        assert conn.execute(
            "SELECT locked_until FROM timeclock.employees WHERE employee_code='1001'"
        ).fetchone()["locked_until"]


def test_personal_ownership_manager_denial_and_disabled_user(
    client, station, manager_headers
):
    headers, action = login(client, station, "1003")
    client.post(
        "/v1/kiosk/punch",
        headers=headers,
        json={"action": action, "request_id": str(uuid4())},
    )
    assert client.get("/v1/me/hours").json()["shifts"] == []
    assert client.get("/v1/admin/overview").status_code == 403
    employee = client.get("/v1/me").json()
    assert (
        client.get(
            f"/v1/admin/employees/{employee['id']}/hours?start=2026-09-01&end=2026-09-08"
        ).status_code
        == 403
    )
    client.patch(
        f"/v1/admin/employees/{employee['id']}",
        headers=manager_headers,
        json={"active": False},
    )
    assert client.get("/v1/me").status_code == 403
    assert (
        client.post(
            "/v1/kiosk/verify",
            headers=station,
            json={"employee_code": "1001", "pin": "246810"},
        ).status_code
        == 401
    )


def test_corrections_preserve_punches_and_reject_stale_changes(
    client, station, manager_headers
):
    headers, action = login(client, station)
    client.post(
        "/v1/kiosk/punch",
        headers=headers,
        json={"action": action, "request_id": str(uuid4())},
    )
    person = client.get("/v1/me").json()
    shift = client.get("/v1/me/hours").json()["open_shift"]
    original = shift["started_at"]
    start = (datetime.now(timezone.utc) - timedelta(hours=2)).isoformat()
    end = (datetime.now(timezone.utc) - timedelta(hours=1)).isoformat()
    request = client.post(
        "/v1/me/requests",
        json={
            "shift_id": shift["id"],
            "proposed_start": start,
            "proposed_end": end,
            "reason": "Forgot to punch at the correct time",
        },
    ).json()
    assert client.get("/v1/me/hours").json()["open_shift"]["started_at"] == original
    body = {
        "employee_id": person["id"],
        "shift_id": shift["id"],
        "version": 1,
        "started_at": start,
        "ended_at": end,
        "reason": "Verified with shift supervisor",
        "request_id": request["id"],
    }
    assert (
        client.post(
            "/v1/admin/adjustments", headers=manager_headers, json=body
        ).status_code
        == 201
    )
    assert (
        client.post(
            "/v1/admin/adjustments", headers=manager_headers, json=body
        ).status_code
        == 409
    )
    evidence = client.get(
        f"/v1/admin/shifts/{shift['id']}/audit", headers=manager_headers
    ).json()
    assert datetime.fromisoformat(
        evidence["punches"][0]["occurred_at"]
    ) == datetime.fromisoformat(original)
    assert len(evidence["adjustments"]) == 1
    assert client.get("/v1/me/requests").json()[0]["status"] == "approved"
    with pytest.raises(psycopg.errors.RaiseException), transaction() as conn:
        conn.execute("UPDATE timeclock.punch_events SET action='out'")


def test_cannot_correct_someone_elses_shift(client, station):
    headers, action = login(client, station, "1003")
    client.post(
        "/v1/kiosk/punch",
        headers=headers,
        json={"action": action, "request_id": str(uuid4())},
    )
    shift = client.get("/v1/me/hours", headers={"x-demo-user": "1003"}).json()[
        "open_shift"
    ]
    assert (
        client.post(
            "/v1/me/requests",
            json={
                "shift_id": shift["id"],
                "proposed_start": shift["started_at"],
                "reason": "Change another employee time",
            },
        ).status_code
        == 404
    )


def test_overlap_is_rejected(client, manager_headers):
    employee = client.get("/v1/me").json()
    start = datetime.now(timezone.utc) - timedelta(days=1)
    body = {
        "employee_id": employee["id"],
        "started_at": start.isoformat(),
        "ended_at": (start + timedelta(hours=2)).isoformat(),
        "reason": "Entered verified missing shift",
    }
    assert (
        client.post(
            "/v1/admin/adjustments", headers=manager_headers, json=body
        ).status_code
        == 201
    )
    assert (
        client.post(
            "/v1/admin/adjustments", headers=manager_headers, json=body
        ).status_code
        == 409
    )


def test_pairing_is_one_time_and_reset_revokes_session(client, manager_headers):
    code = client.post(
        "/v1/admin/terminals", headers=manager_headers, json={"name": "Test station"}
    ).json()["pairing_code"]
    station = client.post("/v1/kiosk/pair", json={"code": code})
    assert station.status_code == 200
    assert client.post("/v1/kiosk/pair", json={"code": code}).status_code == 403
    headers, action = login(
        client, {"x-terminal-token": station.json()["terminal_token"]}
    )
    client.post("/v1/kiosk/reset", headers=headers)
    assert (
        client.post(
            "/v1/kiosk/punch",
            headers=headers,
            json={"action": action, "request_id": str(uuid4())},
        ).status_code
        == 401
    )


def test_wrong_origin_network_and_proxy(client, station, monkeypatch):
    assert client.get("/v1/me", headers={"x-proxy-secret": "wrong"}).status_code == 403
    monkeypatch.setattr(config, "CIDRS", ["192.0.2.0/24"])
    assert client.get("/v1/kiosk/station", headers=station).status_code == 403
    assert (
        client.get(
            "/v1/kiosk/station", headers={**station, "x-client-ip": "192.0.2.1"}
        ).status_code
        == 200
    )


@pytest.mark.parametrize(
    "start,end,hours",
    [
        ("2026-03-08T00:00:00-05:00", "2026-03-09T00:00:00-04:00", 23),
        ("2026-11-01T00:00:00-04:00", "2026-11-02T00:00:00-05:00", 25),
    ],
)
def test_daylight_saving_totals(start, end, hours):
    left, right = datetime.fromisoformat(start), datetime.fromisoformat(end)
    rows = daily_totals(
        [{"started_at": left, "ended_at": right}], left.date(), right.date()
    )
    assert sum(row["seconds"] for row in rows) == hours * 3600


def test_overnight_period_split_and_open_exclusion():
    start = datetime.fromisoformat("2026-09-13T23:00:00-04:00")
    end = datetime.fromisoformat("2026-09-14T02:00:00-04:00")
    rows = daily_totals(
        [
            {"started_at": start, "ended_at": end},
            {"started_at": start, "ended_at": None},
        ],
        start.date(),
        end.date() + timedelta(days=1),
    )
    assert [r["seconds"] for r in rows] == [3600, 7200]


def test_csv_formula_escape_and_nonmanager_denied(client, manager_headers):
    with transaction() as conn:
        conn.execute(
            "UPDATE timeclock.employees SET name='=1+1' WHERE employee_code='1001'"
        )
    path = "/v1/admin/export?start=2026-09-01&end=2026-09-08"
    assert client.get(path).status_code == 403
    response = client.get(path, headers=manager_headers)
    assert response.status_code == 200
    assert "'=1+1" in response.text


def test_production_rejects_demo(monkeypatch):
    monkeypatch.setattr(config, "ENV", "production")
    with pytest.raises(RuntimeError, match="forbidden"):
        config.validate()
