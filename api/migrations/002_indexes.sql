-- Foreign keys are not indexed automatically; these back the hot lookups.
CREATE INDEX adjustments_by_shift ON timeclock.adjustments(shift_id);
CREATE INDEX punch_events_by_shift ON timeclock.punch_events(shift_id, occurred_at);
CREATE INDEX correction_requests_by_employee ON timeclock.correction_requests(employee_id, created_at DESC);
CREATE INDEX correction_requests_pending ON timeclock.correction_requests(created_at) WHERE status = 'pending';
CREATE INDEX kiosk_sessions_by_employee ON timeclock.kiosk_sessions(employee_id);
CREATE INDEX kiosk_sessions_by_expiry ON timeclock.kiosk_sessions(expires_at);
