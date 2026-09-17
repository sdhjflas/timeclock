"""One-time first-manager provisioning. PIN is prompted, never a command argument."""

import argparse
from getpass import getpass

from . import config
from .db import audit, transaction
from .main import Employee
from .security import hasher


def main():
    config.validate()
    parser = argparse.ArgumentParser()
    parser.add_argument("--email", required=True)
    parser.add_argument("--name", required=True)
    parser.add_argument("--code", required=True)
    args = parser.parse_args()
    data = Employee(
        email=args.email,
        name=args.name,
        employee_code=args.code,
        pin=getpass("New manager PIN (6-10 digits): "),
    )
    with transaction() as conn:
        conn.execute("SELECT pg_advisory_xact_lock(7864333)")
        if conn.execute(
            "SELECT 1 FROM timeclock.employees WHERE manager AND active"
        ).fetchone():
            raise RuntimeError("An active manager exists; use the manager UI")
        row = conn.execute(
            "INSERT INTO timeclock.employees(employee_code,name,email,pin_hash,manager) VALUES(%s,%s,%s,%s,true) RETURNING id",
            (data.employee_code, data.name, data.email, hasher.hash(data.pin)),
        ).fetchone()
        audit(conn, "bootstrap-cli", "manager.bootstrapped", row["id"])
    print("Manager enrolled. Sign in with the approved Google account.")


if __name__ == "__main__":
    main()
