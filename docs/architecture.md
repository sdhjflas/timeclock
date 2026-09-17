# Pathway Time Clock: discovery and proposed architecture

Prepared September 17, 2026 as the design basis for the implemented standalone
application. Deployment-specific controls remain claims to verify during the pilot;
see `operations.md` for current status and launch acceptance.

## PBS HQ findings

Reviewed the local PBS_HQ checkout at commit `09680ed`, including the README,
dashboard design, CSS tokens, root layout, shell, UI primitives, theme provider,
frontend middleware and API client, backend authentication and user resolution,
staff scopes, database pool, and staging restore documentation. This was an
architecture review of the relevant systems, not an exhaustive audit of every
reporting and vendor integration module. Production settings were not inspected.

| Area | Existing PBS HQ implementation | Time-clock direction |
| --- | --- | --- |
| Web | Next.js App Router, React, TypeScript | Keep the same framework and component conventions |
| Design | Tailwind v4 semantic tokens, PBS blue, slate, Geist and Geist Mono, Lucide, Recharts | Reuse this visual language with a much smaller navigation |
| Identity | Clerk; API validates RS256 session JWTs against JWKS | Use Clerk with explicit time-clock enrollment |
| Authorization | Database-backed roles, publisher grants, staff scopes, disabled accounts | Separate employee and time-manager permissions |
| Backend | FastAPI, psycopg connection pool, PostgreSQL | Same architecture, independent service and database initially |
| Hosting | Separate Railway services; GitHub release workflows | Dedicated time-clock project and staging/production environments |
| Recovery | Documented backup restoration and staging validation | Enable backups and prove recovery before payroll use |

Useful source paths in the sibling PBS_HQ repository:

- `web/app/globals.css`, `docs/dashboard-design.md`
- `web/components/shell/app-shell.tsx`, `web/components/ui/`, `web/lib/theme.tsx`
- `web/middleware.ts`, `api/app/auth.py`, `api/app/auth_store.py`
- `api/app/scopes.py`, `docs/staff-scopes.md`
- `api/app/db_pool.py`, `staging-refresh/README.md`

Some auth design documentation describes earlier scaffolding; current executable
code is the stronger evidence. PBS HQ employees have broad publisher access and
HQ admins implicitly receive every registered staff scope. Neither behavior
should automatically confer timekeeping or payroll access. Its publisher grants,
view-as functionality, and email bootstrap promotions should not be copied into
the time clock. An impersonated session must never be allowed to punch.

## Employee experience

- Home: employee name, current status, one prominent Clock in / Clock out action,
  server-confirmed punch time, and current shift duration.
- My hours: day/week/pay-period totals, daily-hours bars, and a read-only shift
  history with explicit missing-punch and correction indicators.
- Report a mistake: submit a requested correction and explanation; this never
  changes recorded or payable time until a manager acts.
- No lunch action or automatic break deduction. Multiple shifts per day are
  supported. An open shift is provisional, not finalized worked time.

Keep PBS HQ's semantic color tokens, 6/8/12/16px corner scale, Geist text,
monospaced/tabular time values, light/dark themes, and restrained motion.
Use clear labels with status colors, keyboard access, and large punch targets.
Do not add performance rankings or infer attendance from an invented schedule.

## Identity and access

1. A manager creates an active employee record with the exact approved email.
2. Clerk verifies ownership through the confirmed Google Workspace identity
   provider. Use Sign in with Google with verified, explicitly enrolled Pathway
   accounts. Typing an email is not authentication.
3. First sign-in binds a verified approved identity to that employee atomically.
   Store provider issuer and subject alongside an independent employee UUID.
   Reject duplicate bindings and unapproved accounts, even on the correct domain.
4. Later requests resolve identity through the stable binding; email changes do
   not silently transfer a time record to another account.
5. Every request checks current employee status and required permissions. Employee
   queries derive ownership from the authenticated session, never a client-supplied
   employee ID. Only explicitly appointed time managers can access team records,
   exports, provisioning, and corrections.

Prefer the existing production Clerk identity pool if domain/session configuration
supports it. This is not permission to alter PBS HQ's production settings. Use a
development identity environment during implementation. If a separate production
identity pool is necessary, preserve an explicit identity mapping for integration.
Clerk supports shared authentication across satellite domains, but configuration
and plan eligibility must be checked for the actual deployment.

Validate token signature, issuer, expiration, required session claims, and allowed
authorized parties; validate audience if configured. Require actual verified-email
state for enrollment. Fail closed without production auth configuration. Protect
cookie-authenticated mutations against CSRF, restrict origins, rate-limit sensitive
actions, and require stronger authentication for managers. Never expose database
credentials or service credentials in the browser.

## Shared warehouse computers and location

Confirmed by the user: punches only from the warehouse; history accessible
anywhere after authentication. Employee email is managed through Google Workspace.

A server-enforced warehouse public-IP allowlist is a simple initial control if
the internet connection has a stable address. Only trust forwarding headers from
the known ingress; test the actual Railway proxy chain before relying on it.
This limits network origin, not physical presence, and warehouse VPN access or
remote desktop can bypass the physical-location assumption. GPS, browser device
IDs, and a hidden URL are not adequate replacements.

For stricter dedicated-terminal enforcement, use managed kiosk devices with a
properly provisioned device credential. A reusable secret shipped in frontend
JavaScript is not a device credential. Personal authentication is still required.

After a kiosk punch, show a brief receipt and reset the app session; expire idle
sessions and prevent cached personal pages. Manage the browser profile so the
underlying Google/Microsoft session cannot silently sign in the previous person.
Clerk sign-out alone does not guarantee upstream provider sign-out. Test this on
the actual shared PCs. Identity controls cannot fully prevent voluntary credential
sharing or one employee punching for another.

## Punch integrity and data model

Suggested tables within a dedicated `timeclock` schema:

| Table | Purpose |
| --- | --- |
| employees | UUID, name, approved email, active status |
| identity_bindings | Unique provider issuer/subject to employee mapping |
| manager_grants | Explicit time-manager authorization |
| punch_events | Immutable in/out events, employee, server UTC timestamp, request ID, origin |
| shift_state | Transactionally maintained current open shift; rebuildable from events |
| correction_requests | Employee explanation and proposed change; approval state |
| adjustments | Append-only manager decisions, previous/replacement values, reason and actor |
| audit_events | Enrollment, access changes, corrections and exports |

The browser submits an action and idempotency key, never an authoritative punch
timestamp. Serialize mutations per employee in PostgreSQL, assign database time
after acquiring the lock, and commit the event and shift state together. Enforce
one open shift per employee and reject invalid transitions. Bind idempotency keys
to employee and action so retries, double-clicks, and multiple tabs cannot create
extra punches. A retry returns the original committed receipt.

Give the runtime database role no update/delete permission on original punch or
audit events; use separate migration credentials. Administrators with database
ownership remain technically capable of changing data, so describe this as
auditable and protected, not absolutely tamper-proof. Restrict those credentials
and maintain separate backups.

Corrections append a documented adjustment; original punches remain visible.
Handle missing clock-outs with a manager exception queue, not invented clock-outs
or automatic shift caps. Deactivation preserves history and flags any open shift.

Compute elapsed duration using UTC instants. Display and divide daily/workweek
totals using an explicitly configured workplace IANA timezone. Split overnight
shifts across local day and pay-period boundaries, including daylight-saving
transitions. Retain exact durations and round only display/export values according
to a confirmed policy. Never infer payable hours by summing rounded chart labels.
Payroll overtime and pay-period rules require confirmation before implementing.

## Hosting, outages, and integration

Browser -> Next.js web -> authenticated FastAPI -> private PostgreSQL on Railway.
Whether the browser calls FastAPI directly or through a same-origin web route,
the API independently enforces authentication and ownership.

Stored punches survive a PC failure or closing the browser. The server stores a
start time; it does not depend on a running browser timer. A warehouse power or
internet outage still prevents that PC from reaching the cloud. For v1, show an
explicit failure/unknown outcome, reconcile retries with the same request ID,
and use manager-reviewed outage corrections. Do not accept untrusted offline
timestamps as authoritative punches. Any emergency alternate-network access
needs an explicit policy compatible with the warehouse restriction.

Use HTTPS, private database networking, health checks, monitored failures,
automated backups, and a tested restore. Set recovery objectives before launch;
cloud hosting alone does not guarantee continuous availability or zero data loss.
Railway documents scheduled volume backups and PostgreSQL point-in-time recovery;
confirm eligibility and enable the chosen configuration rather than assuming it.

Keep the API contract and timekeeping rules independent of the page shell. Later,
mount the UI in PBS HQ and connect identity/permissions deliberately. Do not store
time records in HQ's ETL-rotated `live` schema. Any future shared-database restore
process must explicitly preserve timekeeping data and protect payroll privacy in
staging. Versioned migrations and an API boundary make this integration tractable.

## Build sequence and acceptance checks

1. PBS-matched employee UI using clearly marked fabricated records.
2. Real enrollment/authentication, PostgreSQL migrations, transactional punches,
   and personal history. Remove demo access from production paths.
3. Manager provisioning, exception review, audited corrections, totals and CSV.
4. Warehouse/shared-PC controls, deployment, backups and a small staff pilot.

Before real use, demonstrate denial of another employee's records and all
unauthorized manager actions; rejection of inactive/unapproved users, expired or
wrong-issuer tokens and impersonation; safe concurrent punches and network retries;
correct midnight/DST/pay-period calculations; immutable original events after
correction; shared-PC identity isolation; and successful database recovery.

## Decisions still needed

- Exact approved Pathway Google Workspace domain(s)?
- Is a stable warehouse public IP available, and must punching be restricted to
  designated PCs or may any authenticated device on the warehouse network punch?
- Workplace timezone, pay-period anchor/frequency, and workweek start?
- Who can manage time and approve corrections; which payroll export format?

## External documentation checked

- [Clerk satellite domains](https://clerk.com/docs/guides/dashboard/dns-domains/satellite-domains)
- [Clerk request authentication and authorized parties](https://clerk.com/docs/reference/backend/authenticate-request)
- [Railway PostgreSQL backup and restore](https://docs.railway.com/guides/postgres-backups-restores)
- [Railway point-in-time recovery](https://docs.railway.com/volumes/point-in-time-recovery)
