"use client";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { formatInTimeZone, fromZonedTime } from "date-fns-tz";
import {
  ArrowRight,
  Check,
  ChevronRight,
  Download,
  FileClock,
  Monitor,
  Plus,
  ShieldCheck,
  UsersRound,
  X,
} from "lucide-react";
import {
  api,
  Correction,
  day,
  duration,
  Employee,
  Report,
  send,
  Settings,
  Shift,
  time,
} from "@/lib/client";
import { Loading, Notice, Shell } from "./shell";
import { useModal } from "@/lib/use-modal";

type TeamMember = Employee & Report;
type Overview = {
  employees: TeamMember[];
  requests: Correction[];
  terminals: {
    id: string;
    name: string;
    active: boolean;
    expires_at: string | null;
  }[];
  audit: {
    id: number;
    actor: string;
    action: string;
    target: string;
    created_at: string;
  }[];
  from: string;
  to: string;
};
type Edit = { employee: TeamMember; shift?: Shift; request?: Correction };
export function Admin({ demo }: { demo: boolean }) {
  const [person, setPerson] = useState<Employee>();
  const [data, setData] = useState<Overview>();
  const [zone, setZone] = useState("America/New_York");
  const [tab, setTab] = useState("team");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [selected, setSelected] = useState<string>();
  const [modal, setModal] = useState<
    "employee" | "station" | "access" | "reject" | null
  >(null);
  const [edit, setEdit] = useState<Edit>();
  const [access, setAccess] = useState<TeamMember>();
  const [reject, setReject] = useState<Correction>();
  const [pairing, setPairing] = useState("");
  const [audit, setAudit] = useState<{
    punches: { id: string; action: string; occurred_at: string }[];
    adjustments: {
      id: string;
      actor_name: string;
      reason: string;
      before_value: Record<string, string>;
      after_value: Record<string, string>;
    }[];
  }>();
  const [exportStart, setExportStart] = useState("");
  const [exportEnd, setExportEnd] = useState("");
  const [periodQuery, setPeriodQuery] = useState("");
  const load = useCallback(async () => {
    setError("");
    try {
      const [p, d, s] = await Promise.all([
        api<Employee>("me"),
        api<Overview>("admin/overview" + periodQuery),
        api<Settings>("config"),
      ]);
      setPerson(p);
      setData(d);
      setZone(s.timezone);
      setExportStart(d.from);
      setExportEnd(d.to);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [periodQuery]);
  useEffect(() => {
    void load();
  }, [load]);
  const act = async (fn: () => Promise<void>) => {
    if (busy) return;
    setBusy(true);
    setError("");
    setSuccess("");
    try {
      await fn();
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const member = data?.employees.find((e) => e.id === selected);
  const close = () => {
    setModal(null);
    setEdit(undefined);
    setAudit(undefined);
    setError("");
  };
  useModal(Boolean(modal || edit || audit), () => {
    if (!busy) close();
  });
  const displayInput = (value?: string | null) =>
    value ? formatInTimeZone(new Date(value), zone, "yyyy-MM-dd'T'HH:mm") : "";
  return (
    <Shell demo={demo} name={person?.name} manager={person?.manager}>
      <div className="page-heading">
        <div>
          <div className="eyebrow">A CLEAR VIEW OF YOUR TEAM</div>
          <h1>Team overview</h1>
          <p>People, punches, and the details that need your attention.</p>
        </div>
        <button
          className="button primary"
          disabled={!data}
          onClick={() => setModal("employee")}
        >
          <Plus size={17} /> Add employee
        </button>
      </div>
      <Notice error={error} />
      {success && (
        <div className="success" role="status">
          {success}
        </div>
      )}
      {!data && error && (
        <div className="inline-actions">
          <button className="button secondary" onClick={() => void load()}>
            Retry
          </button>
          <Link
            href={demo ? "/hours" : "/sign-in"}
            className="button secondary"
          >
            {demo ? "Go to My hours to switch preview identity" : "Sign in"}
          </Link>
        </div>
      )}
      {loading ? (
        <Loading />
      ) : (
        data && (
          <>
            <section className="stats-grid">
              <div className="stat hero-stat">
                <span className="stat-label">
                  Team hours <FileClock size={17} />
                </span>
                <strong>
                  {duration(
                    data.employees.reduce((n, e) => n + e.total_seconds, 0),
                  )}
                </strong>
                <small>Completed time · Selected period</small>
              </div>
              <div className="stat">
                <span className="stat-label">
                  On the clock <UsersRound size={17} />
                </span>
                <strong>
                  {data.employees.filter((e) => e.open_shift).length}
                  <span> people</span>
                </strong>
                <small>
                  {data.employees.filter((e) => e.active).length} active
                  employees
                </small>
              </div>
              <div className="stat">
                <span className="stat-label">
                  Needs review <ShieldCheck size={17} />
                </span>
                <strong>
                  {data.requests.length}
                  <span> requests</span>
                </strong>
                <small>Corrections awaiting a decision</small>
              </div>
            </section>
            <div className="tabs" role="tablist">
              {[
                ["team", "Team"],
                ["requests", `Requests (${data.requests.length})`],
                ["stations", "Stations"],
                ["audit", "Activity"],
              ].map(([id, label]) => (
                <button
                  key={id}
                  role="tab"
                  aria-selected={tab === id}
                  onClick={() => {
                    setTab(id);
                    setSelected(undefined);
                  }}
                  className={tab === id ? "active" : ""}
                >
                  {label}
                </button>
              ))}
            </div>
            {tab === "team" && (
              <>
                <div className="export-bar">
                  <div>
                    <label>
                      From
                      <input
                        aria-label="Export start"
                        type="date"
                        value={exportStart}
                        onChange={(e) => setExportStart(e.target.value)}
                      />
                    </label>
                    <label>
                      Until (exclusive)
                      <input
                        aria-label="Export end"
                        type="date"
                        value={exportEnd}
                        onChange={(e) => setExportEnd(e.target.value)}
                      />
                    </label>
                    <button
                      className="button secondary"
                      disabled={!exportStart || !exportEnd}
                      onClick={() => {
                        setSelected(undefined);
                        setPeriodQuery(
                          `?start=${exportStart}&end=${exportEnd}`,
                        );
                      }}
                    >
                      View period
                    </button>
                  </div>
                  <button
                    className="button secondary"
                    disabled={busy || !exportStart || !exportEnd}
                    onClick={() =>
                      void act(async () => {
                        const response = await fetch(
                          `/api/admin/export?start=${exportStart}&end=${exportEnd}`,
                        );
                        if (!response.ok) {
                          const d = await response.json();
                          throw new Error(d.detail || "Export failed");
                        }
                        const url = URL.createObjectURL(await response.blob());
                        const a = document.createElement("a");
                        a.href = url;
                        a.download = `pathway-hours-${exportStart}.csv`;
                        a.click();
                        URL.revokeObjectURL(url);
                        setSuccess(
                          "Hours exported. Open shifts are flagged for review.",
                        );
                      })
                    }
                  >
                    <Download size={16} /> Export hours
                  </button>
                </div>
                <section className="panel">
                  <div className="section-heading">
                    <div>
                      <h2>Everyone, accounted for</h2>
                      <p>
                        {day(data.from)} onward · Select an employee to review
                        shifts
                      </p>
                    </div>
                    <span className="pill neutral">
                      {data.employees.length} employees
                    </span>
                  </div>
                  <div className="table-wrap">
                    <table>
                      <thead>
                        <tr>
                          <th>Employee</th>
                          <th>ID</th>
                          <th>Status</th>
                          <th>Completed hours</th>
                          <th>Access</th>
                          <th />
                        </tr>
                      </thead>
                      <tbody>
                        {data.employees.map((e) => (
                          <tr key={e.id}>
                            <td>
                              <button
                                className="employee-link"
                                onClick={() => setSelected(e.id)}
                              >
                                <span className="avatar">
                                  {e.name
                                    .split(" ")
                                    .map((n) => n[0])
                                    .join("")}
                                </span>
                                <span>
                                  {e.name}
                                  <small>{e.email}</small>
                                </span>
                              </button>
                            </td>
                            <td className="numeric">{e.employee_code}</td>
                            <td>
                              <span
                                className={`pill ${!e.active ? "neutral" : e.open_shift ? "green" : "neutral"}`}
                              >
                                {!e.active
                                  ? "Inactive"
                                  : e.open_shift
                                    ? "Clocked in"
                                    : "Clocked out"}
                              </span>
                              {e.open_shift &&
                                Date.now() -
                                  Date.parse(e.open_shift.started_at) >
                                  16 * 3600000 && (
                                  <small className="warning-text">
                                    Long open shift · Review
                                  </small>
                                )}
                            </td>
                            <td className="numeric">
                              {duration(e.total_seconds)}
                            </td>
                            <td>
                              <button
                                className="text-link"
                                onClick={() => {
                                  setAccess(e);
                                  setModal("access");
                                }}
                              >
                                {e.manager ? "Manager" : "Employee"}{" "}
                                <ChevronRight size={13} />
                              </button>
                            </td>
                            <td>
                              <button
                                className="icon-button"
                                aria-label={`View ${e.name}'s shifts`}
                                onClick={() => setSelected(e.id)}
                              >
                                <ChevronRight size={17} />
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </section>
                {member && (
                  <section className="panel">
                    <div className="section-heading">
                      <div>
                        <h2>{member.name}’s shifts</h2>
                        <p>Corrections preserve the original punch records.</p>
                      </div>
                      <button
                        className="button secondary"
                        onClick={() => setEdit({ employee: member })}
                      >
                        <Plus size={16} /> Add missed shift
                      </button>
                    </div>
                    <div className="table-wrap">
                      <table>
                        <thead>
                          <tr>
                            <th>Date</th>
                            <th>Clock in</th>
                            <th>Clock out</th>
                            <th>Duration</th>
                            <th>Review</th>
                          </tr>
                        </thead>
                        <tbody>
                          {member.shifts.map((s) => (
                            <tr key={s.id}>
                              <td>{day(s.started_at, zone)}</td>
                              <td className="numeric">
                                {time(s.started_at, zone)}
                              </td>
                              <td className="numeric">
                                {s.ended_at
                                  ? `${day(s.ended_at, zone)} · ${time(s.ended_at, zone)}`
                                  : "Open"}
                              </td>
                              <td className="numeric">
                                {s.ended_at
                                  ? duration(
                                      (Date.parse(s.ended_at) -
                                        Date.parse(s.started_at)) /
                                        1000,
                                    )
                                  : "In progress"}
                              </td>
                              <td>
                                <div className="inline-actions">
                                  <button
                                    className="text-link"
                                    onClick={() =>
                                      setEdit({ employee: member, shift: s })
                                    }
                                  >
                                    Correct
                                  </button>
                                  <button
                                    className="text-link"
                                    onClick={() =>
                                      void act(async () => {
                                        setAudit(
                                          await api(
                                            `admin/shifts/${s.id}/audit`,
                                          ),
                                        );
                                      })
                                    }
                                  >
                                    Audit trail
                                  </button>
                                </div>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                      {!member.shifts.length && (
                        <div className="empty">No shifts in this period.</div>
                      )}
                    </div>
                  </section>
                )}
              </>
            )}
            {tab === "requests" && (
              <section className="panel">
                <div className="section-heading">
                  <div>
                    <h2>Correction requests</h2>
                    <p>
                      Review the explanation and times before making a decision.
                    </p>
                  </div>
                </div>
                {data.requests.length ? (
                  data.requests.map((r) => (
                    <div className="request-row" key={r.id}>
                      <div>
                        <strong>{r.name}</strong>
                        <p>{r.reason}</p>
                        <small>
                          Requested: {day(r.proposed_start, zone)}{" "}
                          {time(r.proposed_start, zone)} →{" "}
                          {r.proposed_end
                            ? day(r.proposed_end, zone) +
                              " " +
                              time(r.proposed_end, zone)
                            : "Still working"}
                        </small>
                      </div>
                      <div className="inline-actions">
                        <button
                          className="button secondary"
                          onClick={() => {
                            setReject(r);
                            setModal("reject");
                          }}
                        >
                          Decline
                        </button>
                        <button
                          className="button primary"
                          onClick={() => {
                            const e = data.employees.find(
                              (e) => e.id === r.employee_id,
                            )!;
                            setEdit({
                              employee: e,
                              request: r,
                              shift: e.shifts.find((s) => s.id === r.shift_id),
                            });
                          }}
                        >
                          Review <ArrowRight size={15} />
                        </button>
                      </div>
                    </div>
                  ))
                ) : (
                  <div className="empty">
                    <Check size={25} />
                    <h3>You’re all caught up.</h3>
                    <p>New correction requests will appear here.</p>
                  </div>
                )}
              </section>
            )}
            {tab === "stations" && (
              <section className="panel">
                <div className="section-heading">
                  <div>
                    <h2>Warehouse stations</h2>
                    <p>
                      Only paired stations can accept PINs. Pairing codes expire
                      in 10 minutes.
                    </p>
                  </div>
                  <button
                    className="button primary"
                    onClick={() => setModal("station")}
                  >
                    <Plus size={16} /> Add station
                  </button>
                </div>
                {pairing && (
                  <div className="pairing-result">
                    <strong>One-time pairing code</strong>
                    <code>{pairing}</code>
                    <p>
                      Enter this on the warehouse PC’s punch station. Treat it
                      as a password.
                    </p>
                    <button
                      className="text-link"
                      onClick={() => setPairing("")}
                    >
                      Dismiss code
                    </button>
                  </div>
                )}
                {data.terminals.map((t) => (
                  <div className="request-row" key={t.id}>
                    <div className="station-item">
                      <Monitor size={22} />
                      <div>
                        <strong>{t.name}</strong>
                        <p>
                          {!t.active
                            ? "Revoked"
                            : t.expires_at
                              ? `Paired · expires ${day(t.expires_at, zone)}`
                              : "Awaiting pairing"}
                        </p>
                      </div>
                    </div>
                    {t.active && (
                      <button
                        className="button secondary danger"
                        disabled={busy}
                        onClick={() =>
                          void act(async () => {
                            await api(`admin/terminals/${t.id}`, {
                              method: "DELETE",
                            });
                            setSuccess("Station access revoked.");
                          })
                        }
                      >
                        Revoke access
                      </button>
                    )}
                  </div>
                ))}
                {!data.terminals.length && (
                  <div className="empty">Add your first warehouse station.</div>
                )}
              </section>
            )}
            {tab === "audit" && (
              <section className="panel">
                <div className="section-heading">
                  <div>
                    <h2>Recent activity</h2>
                    <p>The latest 50 administrative and security events</p>
                  </div>
                </div>
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>Time</th>
                        <th>Event</th>
                        <th>Actor</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.audit.map((a) => (
                        <tr key={a.id}>
                          <td>
                            {day(a.created_at, zone)} ·{" "}
                            {time(a.created_at, zone)}
                          </td>
                          <td>{a.action.replaceAll(".", " · ")}</td>
                          <td>
                            {data.employees.find((e) => e.id === a.actor)
                              ?.name || a.actor}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {!data.audit.length && (
                    <div className="empty">
                      No administrative changes recorded yet.
                    </div>
                  )}
                </div>
              </section>
            )}
          </>
        )
      )}
      {(modal || edit || audit) && (
        <div className="modal-backdrop">
          <section
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="admin-dialog"
          >
            <div className="section-heading">
              <h2 id="admin-dialog">
                {edit
                  ? "Review a time correction"
                  : audit
                    ? "Originals & corrections"
                    : modal === "employee"
                      ? "Add an employee"
                      : modal === "station"
                        ? "Add a warehouse station"
                        : modal === "reject"
                          ? "Decline request"
                          : "Employee access"}
              </h2>
              <button
                className="icon-button"
                aria-label="Close dialog"
                disabled={busy}
                onClick={close}
              >
                <X size={19} />
              </button>
            </div>
            <Notice error={error} />
            {modal === "employee" && (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  const f = new FormData(e.currentTarget);
                  void act(async () => {
                    await send("admin/employees", Object.fromEntries(f));
                    setModal(null);
                    setSuccess(
                      "Employee created. They can use their PIN here and their approved Google account for history.",
                    );
                  });
                }}
              >
                <label>
                  Full name
                  <input name="name" required minLength={2} maxLength={100} />
                </label>
                <label>
                  Pathway email
                  <input
                    name="email"
                    type="email"
                    placeholder="name@pathwaybook.com"
                    required
                  />
                </label>
                <div className="form-grid">
                  <label>
                    Employee ID
                    <input
                      name="employee_code"
                      inputMode="numeric"
                      pattern="[0-9]{4,10}"
                      required
                    />
                  </label>
                  <label>
                    Private PIN
                    <input
                      name="pin"
                      type="password"
                      inputMode="numeric"
                      pattern="[0-9]{6,10}"
                      autoComplete="new-password"
                      required
                    />
                  </label>
                </div>
                <p className="small">
                  Use a unique 4–10 digit ID and 6–10 digit PIN. Share the PIN
                  privately.
                </p>
                <button className="button primary wide" disabled={busy}>
                  Create employee <Plus size={16} />
                </button>
              </form>
            )}
            {modal === "station" && (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  const f = new FormData(e.currentTarget);
                  void act(async () => {
                    const r = await send<{ pairing_code: string }>(
                      "admin/terminals",
                      { name: f.get("name") },
                    );
                    setPairing(r.pairing_code);
                    setModal(null);
                    setTab("stations");
                  });
                }}
              >
                <label>
                  Station name
                  <input
                    name="name"
                    placeholder="Warehouse · Packing desk"
                    minLength={2}
                    maxLength={80}
                    required
                  />
                </label>
                <p>
                  The paired browser can punch for enrolled employees, but each
                  punch still requires a private PIN.
                </p>
                <button className="button primary wide" disabled={busy}>
                  Generate pairing code <ArrowRight size={16} />
                </button>
              </form>
            )}
            {modal === "access" && access && (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  const f = new FormData(e.currentTarget);
                  void act(async () => {
                    await send(
                      `admin/employees/${access.id}`,
                      {
                        active: f.has("active"),
                        manager: f.has("manager"),
                        ...(f.get("pin") ? { pin: f.get("pin") } : {}),
                      },
                      "PATCH",
                    );
                    setModal(null);
                    setSuccess("Employee access updated.");
                  });
                }}
              >
                <p>
                  {access.name} · {access.email}
                </p>
                <label className="checkbox">
                  <input
                    name="active"
                    type="checkbox"
                    defaultChecked={access.active}
                  />{" "}
                  Active employee
                </label>
                <label className="checkbox">
                  <input
                    name="manager"
                    type="checkbox"
                    defaultChecked={access.manager}
                  />{" "}
                  Time manager — can see and correct all employees’ hours
                </label>
                <label>
                  Reset PIN (optional)
                  <input
                    name="pin"
                    type="password"
                    pattern="[0-9]{6,10}"
                    autoComplete="new-password"
                    placeholder="Leave empty to keep current PIN"
                  />
                </label>
                <button className="button primary wide" disabled={busy}>
                  Save access
                </button>
              </form>
            )}
            {modal === "reject" && reject && (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  const f = new FormData(e.currentTarget);
                  void act(async () => {
                    await send(`admin/requests/${reject.id}/reject`, {
                      reason: f.get("reason"),
                    });
                    setModal(null);
                    setSuccess("Request declined with an explanation.");
                  });
                }}
              >
                <p>
                  {reject.name}: {reject.reason}
                </p>
                <label>
                  Explanation to employee
                  <textarea name="reason" required minLength={8} />
                </label>
                <button className="button primary wide" disabled={busy}>
                  Decline request
                </button>
              </form>
            )}
            {edit && (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  const f = new FormData(e.currentTarget);
                  void act(async () => {
                    await send("admin/adjustments", {
                      employee_id: edit.employee.id,
                      shift_id:
                        edit.request?.shift_id || edit.shift?.id || null,
                      version:
                        edit.request?.version || edit.shift?.version || null,
                      request_id: edit.request?.id || null,
                      started_at: fromZonedTime(
                        String(f.get("start")),
                        zone,
                      ).toISOString(),
                      ended_at: f.get("end")
                        ? fromZonedTime(
                            String(f.get("end")),
                            zone,
                          ).toISOString()
                        : null,
                      reason: f.get("reason"),
                    });
                    setEdit(undefined);
                    setSuccess(
                      "Correction saved. Original punch records are preserved.",
                    );
                  });
                }}
              >
                <p>
                  <strong>{edit.employee.name}</strong>
                  {edit.request && <> · {edit.request.reason}</>}
                </p>
                <div className="form-grid">
                  <label>
                    Clock-in
                    <input
                      name="start"
                      type="datetime-local"
                      required
                      defaultValue={displayInput(
                        edit.request?.proposed_start || edit.shift?.started_at,
                      )}
                    />
                  </label>
                  <label>
                    Clock-out
                    <input
                      name="end"
                      type="datetime-local"
                      defaultValue={displayInput(
                        edit.request
                          ? edit.request.proposed_end
                          : edit.shift?.ended_at,
                      )}
                    />
                  </label>
                </div>
                <small>
                  All times in {zone}. Leave clock-out blank only if still
                  working.
                </small>
                <label>
                  Manager’s reason
                  <textarea
                    name="reason"
                    minLength={8}
                    maxLength={1000}
                    required
                    placeholder="Explain why this correction is accurate…"
                  />
                </label>
                <button className="button primary wide" disabled={busy}>
                  <Check size={17} /> Save audited correction
                </button>
              </form>
            )}
            {audit && (
              <div className="audit-detail">
                <h3>Original punches</h3>
                {audit.punches.map((p) => (
                  <p key={p.id}>
                    Clock {p.action} ·{" "}
                    {new Date(p.occurred_at).toLocaleString("en-US", {
                      timeZone: zone,
                    })}
                  </p>
                ))}
                {!audit.punches.length && (
                  <p>
                    No original punches (sample data or a manager-added shift).
                  </p>
                )}
                <h3>Corrections</h3>
                {audit.adjustments.map((a) => (
                  <div key={a.id}>
                    <strong>{a.actor_name}</strong>
                    <p>{a.reason}</p>
                    <small>
                      Before: {a.before_value.started_at || "No shift"} →{" "}
                      {a.before_value.ended_at || "Open"}
                    </small>
                    <br />
                    <small>
                      After: {a.after_value.started_at} →{" "}
                      {a.after_value.ended_at || "Open"}
                    </small>
                  </div>
                ))}
                {!audit.adjustments.length && <p>No corrections.</p>}
              </div>
            )}
          </section>
        </div>
      )}
    </Shell>
  );
}
