# Pathway Time Clock

Standalone timekeeping for Pathway Book Service, built for later PBS HQ integration.

- Shared warehouse station: employee ID + private PIN, explicit in/out, automatic reset.
- Personal hours: Google/Clerk sign-in for pre-enrolled `@pathwaybook.com` employees.
- Weekly totals, daily chart, read-only shift history, employee correction requests.
- Manager area: employee/PIN administration, station pairing/revocation, correction
  review, original-punch audit trails, historical periods and CSV exports.
- PostgreSQL server timestamps, transactional/idempotent punches, Argon2id PINs,
  employee and station lockouts, ownership checks, immutable event records.
- PBS HQ-compatible Next.js/React/Geist/Lucide/Recharts UI and FastAPI/PostgreSQL API.

**Status:** implemented and locally testable. Not deployed; live Clerk/Google setup,
warehouse device/network controls and production backup/restore need configuration
and acceptance testing before real payroll use. No changes made to PBS HQ.

## Try it locally

See [setup and operations](docs/operations.md) for the complete commands.
Start PostgreSQL with `docker compose up -d`, copy the API/web `.env.example` files,
install dependencies, then run the migration and demo seed. Run the API on **8018**
and the web app on **3010**.

Open **http://localhost:3010/kiosk**, activate the preview station, and use
**employee ID 1001 / PIN 246810**. In **My hours**, choose **Jordan · manager** from
the preview identity selector to explore the manager area. All preview people and
hours are fabricated; demo mode is forbidden in production.

| Directory | Purpose |
| --- | --- |
| `web/` | Next.js frontend and same-origin API gateway |
| `api/` | FastAPI, migrations, administration CLI, PostgreSQL tests |
| `docs/operations.md` | Local setup, Railway deployment, security and acceptance |
| `docs/integration.md` | Boundaries and migration path into PBS HQ |
| `docs/architecture.md` | Initial PBS HQ research and design rationale |

Weekly periods currently start Monday in America/New_York; both are configurable.
No lunch deduction or automatic clock-out. Exports contain recorded durations,
not wage/overtime calculations or payroll-provider submissions.
