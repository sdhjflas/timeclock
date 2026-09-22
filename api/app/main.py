import csv
import io
import ipaddress
from contextlib import asynccontextmanager
from datetime import date, datetime, timedelta, timezone
from typing import Literal
from uuid import UUID

from fastapi import Depends, FastAPI, HTTPException, Request
from fastapi.responses import Response
from psycopg.errors import UniqueViolation
from psycopg.types.json import Jsonb
from pydantic import BaseModel, ConfigDict, Field, field_validator

from . import config
from .db import audit, now, pool, transaction
from .hours import boundary, daily_totals, period
from .security import DUMMY_HASH, check_pin, digest, hasher, manager, proxy, token, user


@asynccontextmanager
async def lifespan(app):
    config.validate()
    yield
    pool().close()


app = FastAPI(title="Pathway Time Clock", version="1.0.0", lifespan=lifespan)


@app.exception_handler(UniqueViolation)
async def duplicate(request, exc):
    from fastapi.responses import JSONResponse

    return JSONResponse(
        status_code=409,
        content={"detail": "This record already exists. Refresh and try again."},
    )


class Input(BaseModel):
    model_config = ConfigDict(extra="forbid")


class Pin(Input):
    employee_code: str = Field(pattern=r"^\d{4,10}$")
    pin: str = Field(pattern=r"^\d{6,10}$")


class Punch(Input):
    request_id: UUID
    action: Literal["in", "out"]


class Pair(Input):
    code: str = Field(min_length=20, max_length=100)


class Employee(Pin):
    name: str = Field(min_length=2, max_length=100)
    email: str = Field(min_length=5, max_length=254)

    @field_validator("email")
    @classmethod
    def email_allowed(cls, value):
        value = value.strip().lower()
        if value.count("@") != 1 or value.rsplit("@", 1)[-1] not in config.DOMAINS:
            raise ValueError("Use an approved Pathway email address")
        return value


class EmployeeUpdate(Input):
    active: bool | None = None
    manager: bool | None = None
    pin: str | None = Field(default=None, pattern=r"^\d{6,10}$")


class TerminalInput(Input):
    name: str = Field(min_length=2, max_length=80)


class Correction(Input):
    shift_id: UUID | None = None
    reason: str = Field(min_length=8, max_length=1000)
    proposed_start: datetime
    proposed_end: datetime | None = None

    @field_validator("proposed_start", "proposed_end")
    @classmethod
    def aware(cls, value):
        if value and value.tzinfo is None:
            raise ValueError("Include a timezone offset")
        return value


class Adjustment(Input):
    employee_id: UUID
    shift_id: UUID | None = None
    version: int | None = None
    started_at: datetime
    ended_at: datetime | None = None
    reason: str = Field(min_length=8, max_length=1000)
    request_id: UUID | None = None

    @field_validator("started_at", "ended_at")
    @classmethod
    def aware(cls, value):
        if value and value.tzinfo is None:
            raise ValueError("Include a timezone offset")
        return value


class Reject(Input):
    reason: str = Field(min_length=8, max_length=1000)


def public_employee(row):
    return {
        key: row[key]
        for key in ("id", "employee_code", "name", "email", "active", "manager")
    }


def terminal(conn, request):
    proxy(request)
    row = conn.execute(
        "SELECT * FROM timeclock.terminals WHERE token_hash=%s FOR UPDATE",
        (digest(request.headers.get("x-terminal-token", "")),),
    ).fetchone()
    timestamp = now(conn)
    if (
        not row
        or not row["active"]
        or not row["expires_at"]
        or row["expires_at"] <= timestamp
    ):
        raise HTTPException(403, "This station needs to be paired by a manager")
    if config.CIDRS:
        try:
            address = ipaddress.ip_address(request.headers.get("x-client-ip", ""))
            allowed = any(
                address in ipaddress.ip_network(cidr) for cidr in config.CIDRS
            )
        except ValueError:
            allowed = False
        if not allowed:
            raise HTTPException(
                403, "Clocking is only available on the warehouse network"
            )
    return row


@app.get("/health")
def health():
    with transaction() as conn:
        conn.execute("SELECT 1 FROM timeclock.schema_migrations LIMIT 1")
    return {"status": "ok"}


@app.get("/v1/config", dependencies=[Depends(proxy)])
def settings():
    return {
        "demo": config.DEMO,
        "timezone": config.TIMEZONE,
        "period_days": config.PERIOD_DAYS,
        "period_anchor": config.PERIOD_ANCHOR,
        "server_time": datetime.now(timezone.utc),
    }


@app.post("/v1/kiosk/pair", dependencies=[Depends(proxy)])
def pair(body: Pair):
    with transaction() as conn:
        row = conn.execute(
            "SELECT * FROM timeclock.terminals WHERE pairing_hash=%s FOR UPDATE",
            (digest(body.code),),
        ).fetchone()
        if not row or not row["active"] or row["pairing_expires"] <= now(conn):
            raise HTTPException(403, "Pairing code is invalid or expired")
        secret = token()
        conn.execute(
            "UPDATE timeclock.terminals SET token_hash=%s, pairing_hash=NULL, pairing_expires=NULL, expires_at=clock_timestamp()+interval '30 days' WHERE id=%s",
            (digest(secret), row["id"]),
        )
        audit(conn, "station", "terminal.paired", row["id"])
        return {"terminal_token": secret, "name": row["name"]}


@app.get("/v1/kiosk/station")
def station(request: Request):
    with transaction() as conn:
        row = terminal(conn, request)
        return {"id": row["id"], "name": row["name"]}


@app.post("/v1/kiosk/reset", dependencies=[Depends(proxy)])
def reset(request: Request):
    with transaction() as conn:
        conn.execute(
            "DELETE FROM timeclock.kiosk_sessions WHERE token_hash=%s",
            (digest(request.headers.get("x-kiosk-session", "")),),
        )
    return {"ok": True}


@app.post("/v1/kiosk/demo", dependencies=[Depends(proxy)])
def demo_station():
    if not config.DEMO:
        raise HTTPException(404, "Not found")
    with transaction() as conn:
        secret = token()
        conn.execute(
            "INSERT INTO timeclock.terminals(name,token_hash,expires_at) VALUES('Warehouse · Preview',%s,clock_timestamp()+interval '30 days')",
            (digest(secret),),
        )
    return {"terminal_token": secret, "name": "Warehouse · Preview"}


@app.post("/v1/kiosk/verify")
def verify(body: Pin, request: Request):
    with transaction() as conn:
        device = terminal(conn, request)
        timestamp = now(conn)
        if device["locked_until"] and device["locked_until"] > timestamp:
            raise HTTPException(
                429, "Too many attempts. Try again in 15 minutes or contact a manager."
            )
        employee = conn.execute(
            "SELECT * FROM timeclock.employees WHERE employee_code=%s FOR UPDATE",
            (body.employee_code,),
        ).fetchone()
        locked = (
            employee
            and employee["locked_until"]
            and employee["locked_until"] > timestamp
        )
        valid = check_pin(employee["pin_hash"] if employee else DUMMY_HASH, body.pin)
        if not employee or not employee["active"] or locked or not valid:
            conn.execute(
                "UPDATE timeclock.terminals SET failed_attempts=CASE WHEN locked_until <= %s THEN 1 ELSE failed_attempts+1 END, locked_until=CASE WHEN failed_attempts>=19 AND (locked_until IS NULL OR locked_until > %s) THEN %s + interval '15 minutes' WHEN locked_until<=%s THEN NULL ELSE locked_until END WHERE id=%s",
                (timestamp, timestamp, timestamp, timestamp, device["id"]),
            )
            if employee and not locked:
                attempts = (
                    1 if employee["locked_until"] else employee["failed_attempts"] + 1
                )
                conn.execute(
                    "UPDATE timeclock.employees SET failed_attempts=%s, locked_until=%s WHERE id=%s",
                    (
                        attempts,
                        timestamp + timedelta(minutes=15) if attempts >= 5 else None,
                        employee["id"],
                    ),
                )
            audit(conn, "station", "pin.rejected", device["id"])
            # Persist the failed-attempt counters before raising the HTTP error.
            failure = True
        else:
            failure = False
            conn.execute(
                "UPDATE timeclock.employees SET failed_attempts=0, locked_until=NULL WHERE id=%s",
                (employee["id"],),
            )
            conn.execute(
                "UPDATE timeclock.terminals SET failed_attempts=0, locked_until=NULL WHERE id=%s",
                (device["id"],),
            )
            # Opportunistic cleanup so long-dead sessions do not accumulate forever.
            conn.execute(
                "DELETE FROM timeclock.kiosk_sessions WHERE expires_at < %s - interval '1 day'",
                (timestamp,),
            )
            shift = conn.execute(
                "SELECT * FROM timeclock.shifts WHERE employee_id=%s AND ended_at IS NULL",
                (employee["id"],),
            ).fetchone()
            secret = token()
            action = "out" if shift else "in"
            conn.execute(
                "INSERT INTO timeclock.kiosk_sessions(token_hash,employee_id,terminal_id,expires_at,action,shift_id) VALUES (%s,%s,%s,%s,%s,%s)",
                (
                    digest(secret),
                    employee["id"],
                    device["id"],
                    timestamp + timedelta(seconds=90),
                    action,
                    shift["id"] if shift else None,
                ),
            )
            response = {
                "session_token": secret,
                "name": employee["name"],
                "action": action,
                "started_at": shift["started_at"] if shift else None,
                "expires_in": 90,
            }
    if failure:
        raise HTTPException(
            401,
            "Employee ID or PIN not recognized, or temporarily locked. Contact your manager if needed.",
        )
    return response


@app.post("/v1/kiosk/punch")
def punch(body: Punch, request: Request):
    with transaction() as conn:
        device = terminal(conn, request)
        session = conn.execute(
            "SELECT * FROM timeclock.kiosk_sessions WHERE token_hash=%s",
            (digest(request.headers.get("x-kiosk-session", "")),),
        ).fetchone()
        if (
            not session
            or session["terminal_id"] != device["id"]
            or session["expires_at"] <= now(conn)
        ):
            raise HTTPException(401, "Session expired. Enter your PIN again.")
        employee = conn.execute(
            "SELECT * FROM timeclock.employees WHERE id=%s FOR UPDATE",
            (session["employee_id"],),
        ).fetchone()
        session = conn.execute(
            "SELECT * FROM timeclock.kiosk_sessions WHERE token_hash=%s FOR UPDATE",
            (session["token_hash"],),
        ).fetchone()
        if not session:
            raise HTTPException(401, "Session reset. Enter your PIN again.")
        if not employee["active"]:
            raise HTTPException(403, "Your account is inactive")
        if session["action"] != body.action:
            raise HTTPException(409, "Action changed. Enter your PIN again.")
        if session["used_request"]:
            if session["used_request"] == body.request_id:
                return session["receipt"]
            raise HTTPException(409, "This session has already recorded a punch")
        timestamp = now(conn)
        shift = conn.execute(
            "SELECT * FROM timeclock.shifts WHERE employee_id=%s AND ended_at IS NULL",
            (employee["id"],),
        ).fetchone()
        if body.action == "in":
            if shift:
                raise HTTPException(409, "Already clocked in. Enter your PIN again.")
            shift = conn.execute(
                "INSERT INTO timeclock.shifts(employee_id,started_at) VALUES(%s,%s) RETURNING *",
                (employee["id"], timestamp),
            ).fetchone()
        else:
            if not shift or shift["id"] != session["shift_id"]:
                raise HTTPException(409, "Shift changed. Enter your PIN again.")
            conn.execute(
                "UPDATE timeclock.shifts SET ended_at=%s, version=version+1 WHERE id=%s",
                (timestamp, shift["id"]),
            )
        event = conn.execute(
            "INSERT INTO timeclock.punch_events(shift_id,employee_id,terminal_id,action,occurred_at,request_id) VALUES(%s,%s,%s,%s,%s,%s) RETURNING id",
            (
                shift["id"],
                employee["id"],
                device["id"],
                body.action,
                timestamp,
                body.request_id,
            ),
        ).fetchone()
        receipt = {
            "id": str(event["id"]),
            "name": employee["name"],
            "action": body.action,
            "occurred_at": timestamp.isoformat(),
            "seconds": (timestamp - shift["started_at"]).total_seconds()
            if body.action == "out"
            else None,
        }
        conn.execute(
            "UPDATE timeclock.kiosk_sessions SET used_request=%s, receipt=%s WHERE token_hash=%s",
            (body.request_id, Jsonb(receipt), session["token_hash"]),
        )
        return receipt


def history(conn, employee_id, start, end):
    if end <= start or (end - start).days > 93:
        raise HTTPException(422, "Choose a range of 1 to 93 days")
    shifts = conn.execute(
        """SELECT s.*, EXISTS(SELECT 1 FROM timeclock.adjustments a WHERE a.shift_id=s.id) AS adjusted
        FROM timeclock.shifts s WHERE employee_id=%s AND started_at < %s
        AND (ended_at IS NULL OR ended_at > %s) ORDER BY started_at DESC""",
        (employee_id, boundary(end), boundary(start)),
    ).fetchall()
    totals = daily_totals(shifts, start, end)
    opened = conn.execute(
        "SELECT * FROM timeclock.shifts WHERE employee_id=%s AND ended_at IS NULL",
        (employee_id,),
    ).fetchone()
    return {
        "shifts": shifts,
        "daily": totals,
        "total_seconds": sum(d["seconds"] for d in totals),
        "open_shift": opened,
        "from": start,
        "to": end,
    }


@app.get("/v1/me")
def me(person=Depends(user)):
    return public_employee(person)


@app.get("/v1/me/hours")
def my_hours(start: date | None = None, end: date | None = None, person=Depends(user)):
    default_start, default_end = period(datetime.now(config.ZONE).date())
    with transaction() as conn:
        return history(conn, person["id"], start or default_start, end or default_end)


@app.get("/v1/me/requests")
def my_requests(person=Depends(user)):
    with transaction() as conn:
        return conn.execute(
            "SELECT * FROM timeclock.correction_requests WHERE employee_id=%s ORDER BY created_at DESC LIMIT 100",
            (person["id"],),
        ).fetchall()


@app.post("/v1/me/requests", status_code=201)
def request_correction(body: Correction, person=Depends(user)):
    with transaction() as conn:
        if (
            body.shift_id
            and not conn.execute(
                "SELECT 1 FROM timeclock.shifts WHERE id=%s AND employee_id=%s",
                (body.shift_id, person["id"]),
            ).fetchone()
        ):
            raise HTTPException(404, "Shift not found")
        if body.proposed_end and body.proposed_end <= body.proposed_start:
            raise HTTPException(422, "Clock-out must be after clock-in")
        if body.proposed_start > now(conn) or (
            body.proposed_end and body.proposed_end > now(conn)
        ):
            raise HTTPException(422, "Requested times cannot be in the future")
        # Serialize requests per employee and cap pending work to prevent accidental flooding.
        conn.execute(
            "SELECT id FROM timeclock.employees WHERE id=%s FOR UPDATE", (person["id"],)
        )
        count = conn.execute(
            "SELECT count(*) n FROM timeclock.correction_requests WHERE employee_id=%s AND status='pending'",
            (person["id"],),
        ).fetchone()["n"]
        if count >= 10:
            raise HTTPException(
                429, "Please wait for your pending requests to be reviewed"
            )
        row = conn.execute(
            "INSERT INTO timeclock.correction_requests(employee_id,shift_id,reason,proposed_start,proposed_end) VALUES(%s,%s,%s,%s,%s) RETURNING *",
            (
                person["id"],
                body.shift_id,
                body.reason,
                body.proposed_start,
                body.proposed_end,
            ),
        ).fetchone()
        audit(conn, person["id"], "correction.requested", row["id"])
        return row


@app.get("/v1/admin/overview")
def overview(
    start: date | None = None, end: date | None = None, person=Depends(manager)
):
    default_start, default_end = period(datetime.now(config.ZONE).date())
    start, end = start or default_start, end or default_end
    with transaction() as conn:
        employees = conn.execute(
            "SELECT * FROM timeclock.employees ORDER BY name"
        ).fetchall()
        rows = [
            {**public_employee(e), **history(conn, e["id"], start, end)}
            for e in employees
        ]
        requests = conn.execute("""SELECT r.*, e.name, s.version FROM timeclock.correction_requests r
            JOIN timeclock.employees e ON e.id=r.employee_id LEFT JOIN timeclock.shifts s ON s.id=r.shift_id
            WHERE r.status='pending' ORDER BY r.created_at""").fetchall()
        terminals = conn.execute(
            "SELECT id,name,active,expires_at,created_at FROM timeclock.terminals ORDER BY created_at DESC"
        ).fetchall()
        audits = conn.execute(
            "SELECT * FROM timeclock.audit ORDER BY id DESC LIMIT 50"
        ).fetchall()
        return {
            "employees": rows,
            "requests": requests,
            "terminals": terminals,
            "audit": audits,
            "from": start,
            "to": end,
        }


@app.post("/v1/admin/employees", status_code=201)
def add_employee(body: Employee, person=Depends(manager)):
    with transaction() as conn:
        row = conn.execute(
            "INSERT INTO timeclock.employees(employee_code,name,email,pin_hash) VALUES(%s,%s,%s,%s) RETURNING *",
            (body.employee_code, body.name.strip(), body.email, hasher.hash(body.pin)),
        ).fetchone()
        audit(conn, person["id"], "employee.created", row["id"])
        return public_employee(row)


@app.patch("/v1/admin/employees/{employee_id}")
def edit_employee(employee_id: UUID, body: EmployeeUpdate, person=Depends(manager)):
    if employee_id == person["id"] and (body.active is False or body.manager is False):
        raise HTTPException(409, "You cannot remove your own manager access")
    with transaction() as conn:
        row = conn.execute(
            "SELECT * FROM timeclock.employees WHERE id=%s FOR UPDATE", (employee_id,)
        ).fetchone()
        if not row:
            raise HTTPException(404, "Employee not found")
        conn.execute(
            "UPDATE timeclock.employees SET active=%s, manager=%s, pin_hash=%s, failed_attempts=0, locked_until=NULL WHERE id=%s",
            (
                row["active"] if body.active is None else body.active,
                row["manager"] if body.manager is None else body.manager,
                hasher.hash(body.pin) if body.pin else row["pin_hash"],
                employee_id,
            ),
        )
        # Invalidate outstanding kiosk capabilities when credentials or access change.
        conn.execute(
            "DELETE FROM timeclock.kiosk_sessions WHERE employee_id=%s", (employee_id,)
        )
        audit(
            conn,
            person["id"],
            "employee.updated",
            employee_id,
            {
                "active": body.active,
                "manager": body.manager,
                "pin_reset": bool(body.pin),
            },
        )
    return {"ok": True}


@app.post("/v1/admin/terminals", status_code=201)
def add_terminal(body: TerminalInput, person=Depends(manager)):
    with transaction() as conn:
        secret = token()
        row = conn.execute(
            "INSERT INTO timeclock.terminals(name,pairing_hash,pairing_expires) VALUES(%s,%s,clock_timestamp()+interval '10 minutes') RETURNING id",
            (body.name, digest(secret)),
        ).fetchone()
        audit(conn, person["id"], "terminal.created", row["id"])
        return {"id": row["id"], "pairing_code": secret, "expires_in": 600}


@app.delete("/v1/admin/terminals/{terminal_id}")
def revoke_terminal(terminal_id: UUID, person=Depends(manager)):
    with transaction() as conn:
        row = conn.execute(
            "UPDATE timeclock.terminals SET active=false WHERE id=%s RETURNING id",
            (terminal_id,),
        ).fetchone()
        if not row:
            raise HTTPException(404, "Station not found")
        audit(conn, person["id"], "terminal.revoked", terminal_id)
    return {"ok": True}


@app.get("/v1/admin/employees/{employee_id}/hours")
def employee_hours(employee_id: UUID, start: date, end: date, person=Depends(manager)):
    with transaction() as conn:
        return history(conn, employee_id, start, end)


@app.get("/v1/admin/shifts/{shift_id}/audit")
def shift_audit(shift_id: UUID, person=Depends(manager)):
    with transaction() as conn:
        return {
            "punches": conn.execute(
                "SELECT * FROM timeclock.punch_events WHERE shift_id=%s ORDER BY occurred_at",
                (shift_id,),
            ).fetchall(),
            "adjustments": conn.execute(
                "SELECT a.*,e.name actor_name FROM timeclock.adjustments a JOIN timeclock.employees e ON e.id=a.actor WHERE shift_id=%s ORDER BY created_at",
                (shift_id,),
            ).fetchall(),
        }


@app.post("/v1/admin/adjustments", status_code=201)
def adjust(body: Adjustment, person=Depends(manager)):
    with transaction() as conn:
        if not conn.execute(
            "SELECT id FROM timeclock.employees WHERE id=%s FOR UPDATE",
            (body.employee_id,),
        ).fetchone():
            raise HTTPException(404, "Employee not found")
        timestamp = now(conn)
        if body.started_at > timestamp or (
            body.ended_at
            and (body.ended_at <= body.started_at or body.ended_at > timestamp)
        ):
            raise HTTPException(
                422, "Times must be in the past, with clock-out after clock-in"
            )
        original = None
        if body.shift_id:
            original = conn.execute(
                "SELECT * FROM timeclock.shifts WHERE id=%s AND employee_id=%s FOR UPDATE",
                (body.shift_id, body.employee_id),
            ).fetchone()
            if not original:
                raise HTTPException(404, "Shift not found")
            if original["version"] != body.version:
                raise HTTPException(
                    409, "This shift changed. Refresh before correcting it."
                )
        if body.request_id:
            correction = conn.execute(
                "SELECT * FROM timeclock.correction_requests WHERE id=%s FOR UPDATE",
                (body.request_id,),
            ).fetchone()
            if (
                not correction
                or correction["employee_id"] != body.employee_id
                or correction["shift_id"] != body.shift_id
                or correction["status"] != "pending"
            ):
                raise HTTPException(
                    409, "Correction request changed. Refresh before reviewing."
                )
        overlap = conn.execute(
            """SELECT id FROM timeclock.shifts WHERE employee_id=%s AND (%s::uuid IS NULL OR id<>%s)
            AND tstzrange(started_at,ended_at,'[)') && tstzrange(%s,%s,'[)') LIMIT 1""",
            (
                body.employee_id,
                body.shift_id,
                body.shift_id,
                body.started_at,
                body.ended_at,
            ),
        ).fetchone()
        if overlap:
            raise HTTPException(
                409, "This would overlap another shift; correct that shift first"
            )
        if original:
            shift = conn.execute(
                "UPDATE timeclock.shifts SET started_at=%s, ended_at=%s, version=version+1 WHERE id=%s RETURNING *",
                (body.started_at, body.ended_at, body.shift_id),
            ).fetchone()
        else:
            shift = conn.execute(
                "INSERT INTO timeclock.shifts(employee_id,started_at,ended_at) VALUES(%s,%s,%s) RETURNING *",
                (body.employee_id, body.started_at, body.ended_at),
            ).fetchone()

        def values(row):
            return (
                {
                    key: str(row[key]) if row[key] is not None else None
                    for key in ("started_at", "ended_at", "version")
                }
                if row
                else {}
            )

        conn.execute(
            "INSERT INTO timeclock.adjustments(shift_id,actor,reason,before_value,after_value) VALUES(%s,%s,%s,%s,%s)",
            (
                shift["id"],
                person["id"],
                body.reason,
                Jsonb(values(original)),
                Jsonb(values(shift)),
            ),
        )
        if body.request_id:
            conn.execute(
                "UPDATE timeclock.correction_requests SET status='approved',resolved_by=%s,resolution_reason=%s,resolved_at=%s WHERE id=%s",
                (person["id"], body.reason, timestamp, body.request_id),
            )
        audit(
            conn, person["id"], "shift.corrected", shift["id"], {"reason": body.reason}
        )
        return shift


@app.post("/v1/admin/requests/{request_id}/reject")
def reject(request_id: UUID, body: Reject, person=Depends(manager)):
    with transaction() as conn:
        row = conn.execute(
            "UPDATE timeclock.correction_requests SET status='rejected',resolved_by=%s,resolution_reason=%s,resolved_at=clock_timestamp() WHERE id=%s AND status='pending' RETURNING id",
            (person["id"], body.reason, request_id),
        ).fetchone()
        if not row:
            raise HTTPException(409, "Request already reviewed or not found")
        audit(
            conn,
            person["id"],
            "correction.rejected",
            request_id,
            {"reason": body.reason},
        )
    return {"ok": True}


@app.get("/v1/admin/export")
def export(start: date, end: date, person=Depends(manager)):
    with transaction() as conn:
        employees = conn.execute(
            "SELECT * FROM timeclock.employees ORDER BY name"
        ).fetchall()
        output = io.StringIO()
        writer = csv.writer(output)
        writer.writerow(
            [
                "Employee ID",
                "Name",
                "Email",
                "Date",
                "Worked seconds",
                "Worked hours",
                "Open shift - review required",
            ]
        )

        def safe(value):
            return "'" + value if value and value[0] in "=+-@\t\r\n" else value

        for employee in employees:
            report = history(conn, employee["id"], start, end)
            for day in report["daily"]:
                writer.writerow(
                    [
                        employee["employee_code"],
                        safe(employee["name"]),
                        safe(employee["email"]),
                        day["date"],
                        day["seconds"],
                        f"{day['seconds'] / 3600:.4f}",
                        bool(report["open_shift"]),
                    ]
                )
        audit(conn, person["id"], "hours.exported", f"{start}/{end}")
        return Response(
            output.getvalue(),
            media_type="text/csv",
            headers={
                "Content-Disposition": f'attachment; filename="pathway-hours-{start}.csv"'
            },
        )
