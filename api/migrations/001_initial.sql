CREATE SCHEMA IF NOT EXISTS timeclock;
CREATE TABLE timeclock.employees (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 employee_code text UNIQUE NOT NULL CHECK (employee_code ~ '^[0-9]{4,10}$'),
 name text NOT NULL, email text UNIQUE NOT NULL CHECK (email = lower(email)),
 pin_hash text NOT NULL, active boolean NOT NULL DEFAULT true,
 manager boolean NOT NULL DEFAULT false,
 identity_issuer text, identity_subject text,
 failed_attempts integer NOT NULL DEFAULT 0, locked_until timestamptz,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(identity_issuer, identity_subject)
);
CREATE TABLE timeclock.terminals (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text NOT NULL,
 token_hash text UNIQUE, pairing_hash text UNIQUE,
 pairing_expires timestamptz, expires_at timestamptz,
 active boolean NOT NULL DEFAULT true,
 failed_attempts integer NOT NULL DEFAULT 0, locked_until timestamptz,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE timeclock.shifts (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 employee_id uuid NOT NULL REFERENCES timeclock.employees(id),
 started_at timestamptz NOT NULL, ended_at timestamptz,
 version integer NOT NULL DEFAULT 1,
 CHECK (ended_at IS NULL OR ended_at > started_at)
);
CREATE UNIQUE INDEX one_open_shift ON timeclock.shifts(employee_id) WHERE ended_at IS NULL;
CREATE INDEX shift_history ON timeclock.shifts(employee_id, started_at DESC);
CREATE TABLE timeclock.kiosk_sessions (
 token_hash text PRIMARY KEY, employee_id uuid NOT NULL REFERENCES timeclock.employees(id),
 terminal_id uuid NOT NULL REFERENCES timeclock.terminals(id),
 expires_at timestamptz NOT NULL, action text NOT NULL CHECK(action IN ('in','out')),
 shift_id uuid REFERENCES timeclock.shifts(id),
 used_request uuid, receipt jsonb
);
CREATE TABLE timeclock.punch_events (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), shift_id uuid NOT NULL REFERENCES timeclock.shifts(id),
 employee_id uuid NOT NULL REFERENCES timeclock.employees(id),
 terminal_id uuid NOT NULL REFERENCES timeclock.terminals(id),
 action text NOT NULL CHECK(action IN ('in','out')), occurred_at timestamptz NOT NULL,
 request_id uuid UNIQUE NOT NULL
);
CREATE TABLE timeclock.correction_requests (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), employee_id uuid NOT NULL REFERENCES timeclock.employees(id),
 shift_id uuid REFERENCES timeclock.shifts(id), reason text NOT NULL,
 proposed_start timestamptz NOT NULL, proposed_end timestamptz,
 status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','rejected')),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 resolved_by uuid REFERENCES timeclock.employees(id), resolution_reason text,
 resolved_at timestamptz,
 CHECK(proposed_end IS NULL OR proposed_end > proposed_start)
);
CREATE TABLE timeclock.adjustments (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), shift_id uuid NOT NULL REFERENCES timeclock.shifts(id),
 actor uuid NOT NULL REFERENCES timeclock.employees(id), reason text NOT NULL,
 before_value jsonb NOT NULL, after_value jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE timeclock.audit (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 actor text NOT NULL, action text NOT NULL, target text NOT NULL,
 data jsonb NOT NULL DEFAULT '{}', created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE FUNCTION timeclock.reject_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Append-only timekeeping record'; END; $$;
CREATE TRIGGER immutable_punch BEFORE UPDATE OR DELETE ON timeclock.punch_events
 FOR EACH ROW EXECUTE FUNCTION timeclock.reject_mutation();
CREATE TRIGGER immutable_adjustment BEFORE UPDATE OR DELETE ON timeclock.adjustments
 FOR EACH ROW EXECUTE FUNCTION timeclock.reject_mutation();
CREATE TRIGGER immutable_audit BEFORE UPDATE OR DELETE ON timeclock.audit
 FOR EACH ROW EXECUTE FUNCTION timeclock.reject_mutation();
