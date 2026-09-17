# Future PBS HQ integration

The app uses PBS HQ's Next.js App Router/React/TypeScript, FastAPI, Clerk and
PostgreSQL stack. It imports no code or credentials from HQ and runs independently.

## Boundaries

- `api/app/main.py`: versioned `/v1` JSON routes; machine-readable Pydantic contract
  at `/openapi.json`.
- `api/app/hours.py`: authoritative UTC duration math and workplace-local periods.
- `api/app/security.py`: identity verification/enrollment, returning employee UUIDs.
- `timeclock.*`: independently owned/migrated schema, outside ETL `live` rotations.
- `web/components/{kiosk,hours,admin}.tsx`: route-level UI. Replace `shell.tsx` with
  the HQ shell for employee/manager views; keep kiosk a dedicated page.
- `web/app/api/[...path]/route.ts`: same-origin gateway, Clerk session forwarding,
  Origin checks and HttpOnly terminal/punch cookies. No browser database access.

Employee UUIDs survive email/provider/application changes. Reuse the Clerk instance
when possible; otherwise migrate issuer/subject bindings explicitly with verified
ownership and an audit. Never silently rematch an unverified email.

HQ publisher/employee/admin roles grant no time-clock access automatically. Keep
explicit enrollment and manager grants. If using HQ scopes later, add timekeeping
permissions and consciously review HQ's “admin implies all scopes” behavior for
payroll privacy. View-as sessions must never mint punch capabilities or mutate time.
Station and PIN capabilities must never become HQ authentication sessions.

## Migration sequence

1. Add My hours to HQ behind enrollment, calling the standalone API/database.
2. Add team management behind explicit timekeeping permissions; keep API guards.
3. Preserve the kiosk origin/profile boundary. Paired-browser personal-portal
   blocking must remain effective under integrated routes. Configure authorized
   parties and gateway routes deliberately.
4. If consolidating databases later, migrate the entire `timeclock` schema during
   a controlled cutover, reconcile totals/counts and preserve all UUIDs, original
   timestamps, constraints and audit history.
5. Update backup/restore jobs explicitly. Never overwrite production timekeeping
   with staging data, and restrict/mask payroll data in broad HQ staging copies.

The compatible stack and visual language reduce integration work. Identity,
permissions, schema migration and recovery still require a deliberate cutover.
