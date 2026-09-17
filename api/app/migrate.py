from pathlib import Path

import psycopg

from . import config


def migrate():
    # Supply a separate migration credential in production; never grant DDL to runtime.
    import os

    with psycopg.connect(
        os.getenv("MIGRATION_DATABASE_URL") or config.DATABASE_URL
    ) as conn:
        conn.execute("SELECT pg_advisory_xact_lock(7864332)")
        conn.execute("CREATE SCHEMA IF NOT EXISTS timeclock")
        conn.execute(
            "CREATE TABLE IF NOT EXISTS timeclock.schema_migrations (version text PRIMARY KEY)"
        )
        for path in sorted((Path(__file__).parent.parent / "migrations").glob("*.sql")):
            if not conn.execute(
                "SELECT 1 FROM timeclock.schema_migrations WHERE version=%s",
                (path.name,),
            ).fetchone():
                conn.execute(path.read_text(encoding="utf-8"))
                conn.execute(
                    "INSERT INTO timeclock.schema_migrations VALUES (%s)", (path.name,)
                )


if __name__ == "__main__":
    migrate()
