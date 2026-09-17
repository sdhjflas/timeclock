"use client";
import Link from "next/link";
import dynamic from "next/dynamic";
import { useCallback, useEffect, useState } from "react";
import {
  ArrowRight,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Clock3,
  FileClock,
  Plus,
  X,
} from "lucide-react";
import { addDays, format } from "date-fns";
import { fromZonedTime } from "date-fns-tz";
import {
  api,
  Correction,
  day,
  duration,
  Employee,
  Report,
  send,
  Settings,
  time,
} from "@/lib/client";
import { Loading, Notice, Shell } from "./shell";
import { useModal } from "@/lib/use-modal";
const HoursChart = dynamic(() => import("./hours-chart"), {
  ssr: false,
  loading: () => <div className="chart" />,
});

export function Hours({ demo }: { demo: boolean }) {
  const [person, setPerson] = useState<Employee>();
  const [report, setReport] = useState<Report>();
  const [requests, setRequests] = useState<Correction[]>([]);
  const [settings, setSettings] = useState<Settings>();
  const [error, setError] = useState("");
  const [range, setRange] = useState("");
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState(false);
  const [busy, setBusy] = useState(false);
  const [success, setSuccess] = useState("");
  useModal(modal, () => {
    if (!busy) setModal(false);
  });
  const load = useCallback(async () => {
    setError("");
    setLoading(true);
    try {
      const [p, r, s, q] = await Promise.all([
        api<Employee>("me"),
        api<Report>("me/hours" + range),
        api<Settings>("config"),
        api<Correction[]>("me/requests"),
      ]);
      setPerson(p);
      setReport(r);
      setSettings(s);
      setRequests(q);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [range]);
  useEffect(() => {
    void load();
  }, [load]);
  const zone = settings?.timezone || "America/New_York";
  const shiftPeriod = (direction: number) => {
    if (!report || !settings) return;
    const start = format(
      addDays(
        new Date(report.from + "T12:00:00"),
        settings.period_days * direction,
      ),
      "yyyy-MM-dd",
    );
    const end = format(
      addDays(new Date(start + "T12:00:00"), settings.period_days),
      "yyyy-MM-dd",
    );
    setRange(`?start=${start}&end=${end}`);
  };
  return (
    <Shell demo={demo} name={person?.name} manager={person?.manager}>
      <div className="page-heading">
        <div>
          <div className="eyebrow">YOUR WORKDAY, ACCOUNTED FOR</div>
          <h1>My hours</h1>
          <p>A clear picture of the time you put in.</p>
        </div>
        <button
          className="button secondary"
          onClick={() => setModal(true)}
          disabled={!person}
        >
          <Plus size={16} /> Report a mistake
        </button>
      </div>
      <Notice error={error} />
      {error && (
        <div className="inline-actions">
          <button className="button secondary" onClick={() => void load()}>
            Retry
          </button>
          {!demo && (
            <Link className="button primary" href="/sign-in">
              Sign in with Google <ArrowRight size={15} />
            </Link>
          )}
        </div>
      )}
      {success && (
        <div className="success" role="status">
          {success}
        </div>
      )}
      {loading ? (
        <Loading />
      ) : (
        report &&
        person && (
          <>
            <div className="period-bar">
              <div>
                <CalendarDays size={17} />
                <strong>
                  {day(report.from)} –{" "}
                  {day(
                    format(
                      addDays(new Date(report.to + "T12:00:00"), -1),
                      "yyyy-MM-dd",
                    ),
                  )}
                </strong>
                <span className="pill neutral">Weekly pay period</span>
              </div>
              <div>
                <button
                  className="icon-button"
                  aria-label="Previous week"
                  onClick={() => shiftPeriod(-1)}
                >
                  <ChevronLeft size={18} />
                </button>
                <button className="text-link" onClick={() => setRange("")}>
                  This week
                </button>
                <button
                  className="icon-button"
                  aria-label="Next week"
                  onClick={() => shiftPeriod(1)}
                >
                  <ChevronRight size={18} />
                </button>
              </div>
            </div>
            <section className="stats-grid">
              <div className="stat hero-stat">
                <span className="stat-label">
                  Completed hours <Clock3 size={17} />
                </span>
                <strong>{duration(report.total_seconds)}</strong>
                <small>This pay period · Open shifts excluded</small>
              </div>
              <div className="stat">
                <span className="stat-label">
                  Days worked <CalendarDays size={17} />
                </span>
                <strong>
                  {report.daily.filter((d) => d.seconds > 0).length}
                  <span> days</span>
                </strong>
                <small>Days with completed time</small>
              </div>
              <div className="stat">
                <span className="stat-label">
                  Current status <FileClock size={17} />
                </span>
                <strong className="status-value">
                  <span
                    className={`status-dot ${report.open_shift ? "on" : ""}`}
                  />
                  {report.open_shift ? "On the clock" : "Clocked out"}
                </strong>
                <small>
                  {report.open_shift
                    ? `Since ${day(report.open_shift.started_at, zone)}, ${time(report.open_shift.started_at, zone)}`
                    : "Ready for your next shift"}
                </small>
              </div>
            </section>
            <section className="panel">
              <div className="section-heading">
                <div>
                  <h2>Your week at a glance</h2>
                  <p>Completed hours each day</p>
                </div>
                <span className="chart-legend">
                  <span /> Worked hours
                </span>
              </div>
              <HoursChart data={report.daily} />
            </section>
            <section className="panel">
              <div className="section-heading">
                <div>
                  <h2>Shift history</h2>
                  <p>
                    Your recorded clock-ins and clock-outs ·{" "}
                    {zone.replace("_", " ")}
                  </p>
                </div>
                <span className="pill neutral">Read only</span>
              </div>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Date</th>
                      <th>Clock in</th>
                      <th>Clock out</th>
                      <th>Shift duration</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.shifts.map((s) => (
                      <tr key={s.id}>
                        <td className="strong">{day(s.started_at, zone)}</td>
                        <td className="numeric">{time(s.started_at, zone)}</td>
                        <td className="numeric">
                          {s.ended_at
                            ? `${day(s.ended_at, zone) !== day(s.started_at, zone) ? day(s.ended_at, zone) + " · " : ""}${time(s.ended_at, zone)}`
                            : "—"}
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
                          <span
                            className={`pill ${s.ended_at ? "neutral" : "green"}`}
                          >
                            {!s.ended_at
                              ? "Open shift"
                              : s.adjusted
                                ? "Corrected"
                                : "Recorded"}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {!report.shifts.length && (
                  <div className="empty">No shifts in this period yet.</div>
                )}
              </div>
              <div className="table-note">
                Shift durations show the whole shift. Weekly totals include only
                time inside the selected period.
              </div>
            </section>
            {requests.length > 0 && (
              <section className="panel">
                <div className="section-heading">
                  <div>
                    <h2>Correction requests</h2>
                    <p>
                      Your original time stays unchanged until a manager reviews
                      it.
                    </p>
                  </div>
                </div>
                {requests.map((r) => (
                  <div className="request-row" key={r.id}>
                    <div>
                      <strong>
                        {day(r.proposed_start, zone)} ·{" "}
                        {time(r.proposed_start, zone)}
                      </strong>
                      <p>{r.reason}</p>
                      {r.resolution_reason && (
                        <small>Manager: {r.resolution_reason}</small>
                      )}
                    </div>
                    <span
                      className={`pill ${r.status === "approved" ? "green" : "neutral"}`}
                    >
                      {r.status}
                    </span>
                  </div>
                ))}
              </section>
            )}
          </>
        )
      )}
      {modal && (
        <div className="modal-backdrop">
          <section
            role="dialog"
            aria-modal="true"
            aria-labelledby="request-title"
            className="modal"
          >
            <div className="section-heading">
              <h2 id="request-title">Report a time mistake</h2>
              <button
                aria-label="Close dialog"
                className="icon-button"
                onClick={() => setModal(false)}
              >
                <X size={19} />
              </button>
            </div>
            <p>
              Your manager will review this. Your hours won’t change
              automatically.
            </p>
            <Notice error={error} />
            <form
              onSubmit={async (e) => {
                e.preventDefault();
                if (busy) return;
                setBusy(true);
                setError("");
                const data = new FormData(e.currentTarget);
                try {
                  await send("me/requests", {
                    shift_id: data.get("shift") || null,
                    proposed_start: fromZonedTime(
                      String(data.get("start")),
                      zone,
                    ).toISOString(),
                    proposed_end: data.get("end")
                      ? fromZonedTime(
                          String(data.get("end")),
                          zone,
                        ).toISOString()
                      : null,
                    reason: data.get("reason"),
                  });
                  setModal(false);
                  setSuccess("Request sent. Your manager will review it.");
                  await load();
                } catch (e) {
                  setError((e as Error).message);
                } finally {
                  setBusy(false);
                }
              }}
            >
              <label>
                Shift
                <select name="shift">
                  <option value="">Missing an entire shift</option>
                  {report?.shifts.map((s) => (
                    <option key={s.id} value={s.id}>
                      {day(s.started_at, zone)} · {time(s.started_at, zone)}
                    </option>
                  ))}
                </select>
              </label>
              <div className="form-grid">
                <label>
                  Correct clock-in
                  <input name="start" type="datetime-local" required />
                </label>
                <label>
                  Correct clock-out
                  <input name="end" type="datetime-local" />
                </label>
              </div>
              <small>
                Enter times in {zone}. Leave clock-out empty only if still
                working.
              </small>
              <label>
                What happened?
                <textarea
                  name="reason"
                  minLength={8}
                  maxLength={1000}
                  required
                  placeholder="Tell your manager what needs correcting…"
                />
              </label>
              <button className="button primary wide" disabled={busy}>
                {busy ? "Sending…" : "Send request"}
                <ArrowRight size={17} />
              </button>
            </form>
          </section>
        </div>
      )}
    </Shell>
  );
}
