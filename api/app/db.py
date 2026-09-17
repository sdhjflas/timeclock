from contextlib import contextmanager
from functools import lru_cache

from psycopg.rows import dict_row
from psycopg.types.json import Jsonb
from psycopg_pool import ConnectionPool

from . import config


@lru_cache
def pool():
    return ConnectionPool(
        config.DATABASE_URL,
        min_size=0,
        max_size=10,
        open=True,
        kwargs={"row_factory": dict_row, "connect_timeout": 10},
    )


@contextmanager
def transaction():
    with pool().connection() as conn:
        with conn.transaction():
            yield conn


def now(conn):
    return conn.execute("SELECT clock_timestamp() AS now").fetchone()["now"]


def audit(conn, actor, action, target, data=None):
    conn.execute(
        "INSERT INTO timeclock.audit(actor, action, target, data) VALUES (%s,%s,%s,%s)",
        (str(actor), action, str(target), Jsonb(data or {})),
    )
