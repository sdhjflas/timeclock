import os
from datetime import date
from zoneinfo import ZoneInfo

from dotenv import load_dotenv

load_dotenv()
ENV = os.getenv("APP_ENV", "production")
DEMO = os.getenv("DEMO_MODE", "false").lower() == "true"
DATABASE_URL = os.getenv("DATABASE_URL", "")
PROXY_SECRET = os.getenv("PROXY_SECRET", "")
TIMEZONE = os.getenv("WORKPLACE_TIMEZONE", "America/New_York")
ZONE = ZoneInfo(TIMEZONE)
PERIOD_ANCHOR = date.fromisoformat(os.getenv("PAY_PERIOD_ANCHOR", "2026-09-07"))
PERIOD_DAYS = int(os.getenv("PAY_PERIOD_DAYS", "7"))
DOMAINS = {
    s.strip().lower()
    for s in os.getenv("ALLOWED_EMAIL_DOMAINS", "").split(",")
    if s.strip()
}
ISSUER = os.getenv("CLERK_ISSUER", "").rstrip("/")
CLERK_SECRET = os.getenv("CLERK_SECRET_KEY", "")
PARTIES = {
    s.strip() for s in os.getenv("AUTHORIZED_PARTIES", "").split(",") if s.strip()
}
CIDRS = [s.strip() for s in os.getenv("WAREHOUSE_CIDRS", "").split(",") if s.strip()]


def validate():
    if ENV not in {"local", "test", "production"}:
        raise RuntimeError("Invalid APP_ENV")
    if not DATABASE_URL or not PROXY_SECRET:
        raise RuntimeError("DATABASE_URL and PROXY_SECRET are required")
    if DEMO and ENV not in {"local", "test"}:
        raise RuntimeError("Demo authentication is forbidden in production")
    if ENV == "production" and len(PROXY_SECRET) < 32:
        raise RuntimeError("Production PROXY_SECRET must have at least 32 characters")
    if not DEMO and (
        not ISSUER.startswith("https://")
        or not CLERK_SECRET
        or not PARTIES
        or not DOMAINS
    ):
        raise RuntimeError(
            "Clerk issuer, secret, authorized parties and email domains are required"
        )
    if PERIOD_DAYS not in {7, 14}:
        raise RuntimeError("PAY_PERIOD_DAYS must be 7 or 14")
