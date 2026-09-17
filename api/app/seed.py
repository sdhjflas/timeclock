from datetime import datetime, time, timedelta

from . import config
from .db import transaction
from .security import hasher


def seed():
    if not config.DEMO or config.ENV not in {"local", "test"}:
        raise RuntimeError("Demo seed is only available in local/test demo mode")
    with transaction() as conn:
        for code, name, manager in [
            ("1001", "Alex Morgan", False),
            ("1002", "Jordan Lee", True),
            ("1003", "Casey Rivera", False),
        ]:
            row = conn.execute(
                """INSERT INTO timeclock.employees(employee_code,name,email,pin_hash,manager)
                VALUES(%s,%s,%s,%s,%s) ON CONFLICT(employee_code) DO NOTHING RETURNING id""",
                (
                    code,
                    name,
                    name.lower().replace(" ", ".") + "@pathwaybook.com",
                    hasher.hash("246810"),
                    manager,
                ),
            ).fetchone()
            if not row:
                continue
            today = datetime.now(config.ZONE).date()
            for offset in range(1, 22):
                day = today - timedelta(days=offset)
                if day.weekday() >= 5:
                    continue
                start = datetime.combine(day, time(8, offset % 13), config.ZONE)
                end = start + timedelta(hours=8, minutes=(offset % 5) * 7)
                conn.execute(
                    "INSERT INTO timeclock.shifts(employee_id,started_at,ended_at) VALUES(%s,%s,%s)",
                    (row["id"], start, end),
                )


if __name__ == "__main__":
    seed()
