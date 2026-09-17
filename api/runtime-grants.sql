-- Run with psql as the migration owner, after creating the runtime login:
-- psql "$MIGRATION_DATABASE_URL" -v runtime_role=timeclock_app -f runtime-grants.sql
-- The runtime login must NOT own this schema/tables or inherit the migration role.
REVOKE ALL ON SCHEMA timeclock FROM PUBLIC;
GRANT USAGE ON SCHEMA timeclock TO :"runtime_role";
GRANT SELECT ON ALL TABLES IN SCHEMA timeclock TO :"runtime_role";
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA timeclock TO :"runtime_role";
GRANT INSERT, UPDATE ON timeclock.employees, timeclock.terminals,
  timeclock.shifts, timeclock.correction_requests TO :"runtime_role";
GRANT INSERT, UPDATE, DELETE ON timeclock.kiosk_sessions TO :"runtime_role";
GRANT INSERT ON timeclock.punch_events, timeclock.adjustments, timeclock.audit TO :"runtime_role";
-- No UPDATE/DELETE/TRUNCATE on original punches, adjustments or audit events.
