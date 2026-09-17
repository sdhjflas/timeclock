# Setup and operations

## Status and settings

Implemented standalone application; not deployed for real payroll. The confirmed
employee domain is `pathwaybook.com`, paid weekly. The configurable preview defaults
are America/New_York and Monday-start weeks (anchor 2026-09-07). Confirm the week
boundary before launch. Rates, overtime classification and payroll submission are
not included; exports contain recorded worked duration.

## Local preview: PowerShell

From the repository root:

```powershell
docker compose up -d
python -m venv .venv
./.venv/Scripts/python.exe -m pip install -r api/requirements-dev.txt -c api/constraints.txt
Copy-Item api/.env.example api/.env
Copy-Item web/.env.example web/.env.local
```

Initialize the database and start the API:

```powershell
cd api
../.venv/Scripts/python.exe -m app.migrate
../.venv/Scripts/python.exe -m app.seed
../.venv/Scripts/python.exe -m uvicorn app.main:app --host 127.0.0.1 --port 8018
```

In another terminal:

```powershell
cd web
npm ci
npm run dev
```

Open http://localhost:3010. Select **Activate preview station**. Sample IDs are
**1001** Alex, **1002** Jordan (manager), **1003** Casey. All sample PINs are
**246810**. My hours includes a preview identity selector; select Jordan for Team
overview. Data persists across container restarts. Seed is additive/idempotent,
not a reset. Never use real employee data in demo mode. API and web both refuse
demo mode with APP_ENV=production.

## Checks

```powershell
cd api
../.venv/Scripts/python.exe -m ruff check app tests
../.venv/Scripts/python.exe -m ruff format --check app tests
../.venv/Scripts/python.exe -m pytest -q
cd ../web
npm run typecheck
npm run build
npx playwright install chromium
npm run test:browser
```

API tests create/destroy uniquely named disposable PostgreSQL databases. They never
truncate the application database. TEST_DATABASE_ADMIN_URL can select the server
where these databases are created and must have CREATE DATABASE permission.
Browser tests require the seeded local API/frontend, create sample employees and
adjust sample shifts. Never target production. Screenshots go to `artifacts/`.
Stop Next dev before building against its `.next` directory; restart afterward,
or build in Docker to avoid concurrent cache writes.

## Railway configuration

Use a dedicated PostgreSQL service, API rooted at `api/`, and web rooted at `web/`.
Each app root has Docker/Railway configuration. Only expose web publicly; API and
PostgreSQL should use private networking. No deployment has been performed.

| Variable | API | Web |
| --- | --- | --- |
| APP_ENV | production | production |
| DEMO_MODE | false | false |
| PROXY_SECRET | Random 32+ character secret | Same value, server-only |
| DATABASE_URL | Restricted runtime PostgreSQL login | Never set |
| WORKPLACE_TIMEZONE | America/New_York, confirm | Read from API |
| PAY_PERIOD_DAYS | 7 | Read from API |
| PAY_PERIOD_ANCHOR | Confirmed first day of a weekly period | Read from API |
| ALLOWED_EMAIL_DOMAINS | pathwaybook.com | Not required |
| CLERK_ISSUER | Exact HTTPS issuer | Not required |
| CLERK_SECRET_KEY | Production secret | Production secret |
| AUTHORIZED_PARTIES | Exact web origin(s), comma-separated | Not required |
| NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY | Not required | Production key at build and runtime |
| API_BASE_URL | Not required | Private API URL and port |
| APP_ORIGIN | Not required | Exact public HTTPS origin |
| NEXT_PUBLIC_CLERK_SIGN_IN_URL | Not required | /sign-in |

Enable Google as the only employee sign-in strategy in Clerk. Configure Google
OAuth redirects, verify the enrolled/unenrolled sign-in paths, and require manager
MFA through the provider policy. Local demo checks do not establish live Google
configuration. Signed-token verification and enrollment are tested separately.
The API binds a verified, approved primary email once to a stable issuer/subject;
later email changes cannot transfer time history to another employee.
If reusing HQ's Clerk instance, verify satellite/subdomain configuration first.
Do not change HQ roles or credentials as part of standalone deployment.

## Migrations and database privileges

Create a migration/schema-owner login and a distinct runtime login without DDL,
superuser or schema ownership. Run `python -m app.migrate` in a dedicated release
job with MIGRATION_DATABASE_URL set to the owner URL. Do not put that credential
on the runtime service. Startup does not migrate; migration failure blocks release.

As owner, apply `api/runtime-grants.sql` with psql's `runtime_role` variable after
migrating. This grants read access, necessary mutable state writes and insert-only
event/audit access. Runtime must not have update/delete/truncate on punches,
adjustments or audit rows. Triggers also reject update/delete. Database owners can
still disable triggers: protect owner credentials and backups independently.

Provision the first manager in a trusted shell using the configured app environment:

```text
python -m app.bootstrap --email manager@pathwaybook.com --name "Manager Name" --code 1001
```

PIN entry is prompted without echo. Bootstrap refuses when an active manager exists.
Subsequent provisioning occurs through Team overview. Email/identity reassignment
is deliberately not exposed in the UI; use a reviewed migration for that operation.

## Shared stations

1. On a personal manager device, create a station under Team overview → Stations.
2. Enter its one-time code on the warehouse PC; the code expires in 10 minutes.
3. The browser receives a 30-day HttpOnly, Secure, SameSite=Strict credential.
   PostgreSQL stores only the token hash. Pairing cannot be reused.
4. Employees enter ID and PIN. Verification creates a 90-second, one-action
   capability. PINs use Argon2id; tokens/PINs never go into localStorage.
5. Punch receipt clears after five seconds. Partial entry resets after 30 seconds.
   A verified but unused session expires after 90 seconds. Reset never clocks out.
6. Revoke lost/replaced stations on the manager device. Every punch checks station
   status. Re-pair after expiration with a new station record.

Use a managed, dedicated browser profile with no saved Google sessions, password
autofill, extensions or personal browsing. Paired production browsers are blocked
from personal/admin APIs and Google sign-in; use a separate device/profile for
history and management. Demo permits navigation between views for review.

Pairing proves an approved browser, not physical presence. Someone controlling a
PC can copy credentials or use remote desktop. For network enforcement, also set
WAREHOUSE_CIDRS on API. Enable TRUST_PROXY_IP on web only after verifying that the
actual hosting ingress overwrites X-Forwarded-For and the selected address cannot
be supplied by callers. Default ignores this header; CIDR checks with a missing or
invalid address fail closed. Test outside access and spoofed forwarding headers.
Never trust a client-supplied IP without a verified ingress trust boundary.

Five wrong PIN attempts lock the employee for 15 minutes; 20 consecutive failures
lock the station for 15 minutes. Manager access/PIN updates clear employee lockout
and invalidate pending punch sessions. Voluntary PIN sharing cannot be eliminated.

## Corrections, failures and exports

PostgreSQL assigns punch timestamps after acquiring locks. A lost response can be
retried with the same request ID to retrieve the original receipt. After session
expiry, authenticate again and check current status. No offline punch queue or
browser timestamp is treated as authoritative. Power/internet outages require
reviewed manager corrections.

Pending requests never change hours. Manager corrections require a reason, preserve
original events, store before/after values, prevent overlap and reject stale edits.
Long open shifts are flagged, never automatically closed. Open time is excluded
from completed totals. Deactivation retains history and open-shift visibility.

CSV contains daily seconds/hours with open-shift flags. Dates are workplace-local;
end dates are exclusive. Midnight and period boundaries split totals. Raw timestamps
retain precision; UI minutes truncate for display, CSV decimal hours use four
places. No deductions, wage/overtime calculation, pay rounding policy, payroll
locking or payroll-provider submission is applied.

## Backup and launch acceptance

Enable automated backups and desired point-in-time recovery; set retention and
recovery objectives. Restore into a separate database and verify employee, punch,
adjustment counts and a known shift. Keep payroll out of general HQ staging refresh.
Operators must configure backups/monitoring; the Dockerfiles do not create them.

Pilot with real Google sign-in, unregistered-account denial, manager MFA, restricted
database role, two actual PCs, station revocation, outside-warehouse denial, PIN
lockout, lost-response retry, overnight/week totals, correction review, browser
reset, CSV comparison and a successful restore before relying on it for payroll.
