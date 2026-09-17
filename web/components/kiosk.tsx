"use client";

import Link from "next/link";
import { FormEvent, useEffect, useRef, useState } from "react";
import {
  ArrowRight,
  ArrowUpRight,
  Check,
  Clock3,
  Delete,
  Fingerprint,
  LockKeyhole,
  Monitor,
  ShieldCheck,
  ArrowLeft,
} from "lucide-react";
import { api, duration, send, Settings, time } from "@/lib/client";
import { Brand, Notice, ThemeToggle } from "./shell";

type Verified = {
  name: string;
  action: "in" | "out";
  started_at: string | null;
};
type Receipt = {
  name: string;
  action: string;
  occurred_at: string;
  seconds: number | null;
};
export function Kiosk({ demo }: { demo: boolean }) {
  const [station, setStation] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [settings, setSettings] = useState<Settings>();
  const [clock, setClock] = useState(new Date());
  const [code, setCode] = useState("");
  const [pin, setPin] = useState("");
  const [pairing, setPairing] = useState("");
  const [verified, setVerified] = useState<Verified | null>(null);
  const [receipt, setReceipt] = useState<Receipt | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [showHistoryHelp, setShowHistoryHelp] = useState(false);
  const [activeInput, setActiveInput] = useState<"code" | "pin">("code");
  const requestId = useRef("");
  const lastInput = useRef(Date.now());
  const expiry = useRef(0);
  const busyRef = useRef(false);
  const offset = useRef(0);
  const reset = async () => {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setCode("");
    setPin("");
    setVerified(null);
    setReceipt(null);
    setError("");
    setActiveInput("code");
    requestId.current = "";
    expiry.current = 0;
    await send("kiosk/reset", {}).catch(() => {});
    busyRef.current = false;
    setBusy(false);
  };
  useEffect(() => {
    api<Settings>("config")
      .then((s) => {
        setSettings(s);
        offset.current = new Date(s.server_time).getTime() - Date.now();
      })
      .catch((e) => setError(e.message));
    api<{ name: string }>("kiosk/station")
      .then((s) => setStation(s.name))
      .catch(() => {})
      .finally(() => setReady(true));
    const interval = setInterval(
      () => setClock(new Date(Date.now() + offset.current)),
      1000,
    );
    return () => clearInterval(interval);
  }, []);
  useEffect(() => {
    const interval = setInterval(() => {
      if (
        !busyRef.current &&
        ((expiry.current && Date.now() > expiry.current) ||
          ((code || pin) && Date.now() - lastInput.current > 30000))
      )
        void reset();
    }, 1000);
    return () => clearInterval(interval);
  }, [code, pin]);
  useEffect(() => {
    if (!receipt) return;
    const timer = setTimeout(() => void reset(), 5000);
    return () => clearTimeout(timer);
  }, [receipt]);
  const run = async (action: () => Promise<void>) => {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setError("");
    try {
      await action();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };
  const verify = (event: FormEvent) => {
    event.preventDefault();
    void run(async () => {
      const response = await send<Verified>("kiosk/verify", {
        employee_code: code,
        pin,
      });
      setVerified(response);
      setPin("");
      setCode("");
      const bytes = crypto.getRandomValues(new Uint8Array(16));
      bytes[6] = (bytes[6] & 15) | 64;
      bytes[8] = (bytes[8] & 63) | 128;
      const hex = Array.from(bytes, (b) =>
        b.toString(16).padStart(2, "0"),
      ).join("");
      requestId.current = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
      expiry.current = Date.now() + 85000;
    });
  };
  const punch = () =>
    void run(async () => {
      if (!verified) return;
      setReceipt(
        await send<Receipt>("kiosk/punch", {
          action: verified.action,
          request_id: requestId.current,
        }),
      );
      setVerified(null);
      expiry.current = 0;
    });
  const addDigit = (digit: string) => {
    lastInput.current = Date.now();
    const set = activeInput === "code" ? setCode : setPin;
    set((v) =>
      digit === "delete" ? v.slice(0, -1) : (v + digit).slice(0, 10),
    );
  };
  const zone = settings?.timezone || "America/New_York";
  return (
    <div className="kiosk-page">
      <header className="kiosk-header">
        <Brand />
        <div className="topbar-actions">
          {station && !demo ? (
            <button
              className="text-link"
              onClick={() => setShowHistoryHelp((v) => !v)}
            >
              My hours <ArrowUpRight size={16} />
            </button>
          ) : (
            <Link className="text-link" href="/hours">
              My hours <ArrowUpRight size={16} />
            </Link>
          )}
          <ThemeToggle />
        </div>
      </header>
      {showHistoryHelp && (
        <div className="history-help" role="status">
          To view your hours, open this website on your own device and choose My
          hours. Sign in with your @pathwaybook.com Google account. This shared
          station is only for clocking in and out.
        </div>
      )}
      {demo && (
        <div className="kiosk-preview">
          PREVIEW ENVIRONMENT{" "}
          <span>
            Sample employee ID <b>1001</b> · PIN <b>246810</b>
          </span>
        </div>
      )}
      <main className="kiosk-layout">
        <section className="kiosk-welcome">
          <div className="eyebrow">
            <span className="small-line" />
            PATHWAY TIME CLOCK
          </div>
          <h1>
            A good day’s work.
            <br />
            <span>Starts here.</span>
          </h1>
          <p>
            Clock in, get going.
            <br />
            We’ll take care of keeping time.
          </p>
          <div className="wall-clock" suppressHydrationWarning>
            {clock.toLocaleTimeString("en-US", {
              hour: "numeric",
              minute: "2-digit",
              timeZone: zone,
            })}
            <span>
              {clock.toLocaleDateString("en-US", {
                weekday: "long",
                month: "long",
                day: "numeric",
                timeZone: zone,
              })}
            </span>
          </div>
          <div className="station-label">
            <Monitor size={17} />
            {station || "Warehouse punch station"}
            <span className={`status-dot ${station ? "on" : ""}`} />
          </div>
        </section>
        <section className="punch-card" aria-live="polite">
          {!ready ? (
            <div className="loading">Connecting to station…</div>
          ) : !station ? (
            <>
              <span className="card-icon">
                <Monitor />
              </span>
              <h2>Set up this station</h2>
              <p>
                A manager can create a one-time pairing code in Team overview →
                Stations.
              </p>
              <Notice error={error} />
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  void run(async () => {
                    const result = await send<{ name: string }>("kiosk/pair", {
                      code: pairing,
                    });
                    setStation(result.name);
                    setPairing("");
                  });
                }}
              >
                <label>
                  Station pairing code
                  <input
                    value={pairing}
                    onChange={(e) => setPairing(e.target.value)}
                    required
                    autoComplete="off"
                  />
                </label>
                <button className="button primary wide" disabled={busy}>
                  Pair this computer <ArrowRight size={17} />
                </button>
              </form>
              {demo && (
                <button
                  className="button secondary wide"
                  disabled={busy}
                  onClick={() =>
                    void run(async () => {
                      const r = await send<{ name: string }>("kiosk/demo", {});
                      setStation(r.name);
                    })
                  }
                >
                  Activate preview station
                </button>
              )}
            </>
          ) : receipt ? (
            <div className="receipt">
              <span className="receipt-check">
                <Check size={35} />
              </span>
              <div className="eyebrow">YOU’RE ALL SET</div>
              <h2>Clocked {receipt.action}.</h2>
              <p>
                {receipt.name},{" "}
                {receipt.action === "in"
                  ? "have a great shift."
                  : "thanks for your work today."}
              </p>
              <div className="receipt-time">
                {time(receipt.occurred_at, zone)}
              </div>
              {receipt.seconds !== null && (
                <p>{duration(receipt.seconds)} recorded this shift</p>
              )}
              <div className="receipt-footer">
                Saved securely · This screen resets automatically
              </div>
              <button
                className="button secondary wide"
                onClick={() => void reset()}
              >
                Next employee <ArrowRight size={17} />
              </button>
            </div>
          ) : verified ? (
            <>
              <button
                className="text-link"
                onClick={() => void reset()}
                disabled={busy}
              >
                <ArrowLeft size={16} /> Not you? Start over
              </button>
              <div className="confirm-avatar">
                {verified.name
                  .split(" ")
                  .map((s) => s[0])
                  .join("")}
              </div>
              <div className="eyebrow">READY WHEN YOU ARE</div>
              <h2>Hi, {verified.name.split(" ")[0]}.</h2>
              <p>
                {verified.action === "in"
                  ? "Your shift starts when you clock in below."
                  : `You’ve been on the clock since ${time(verified.started_at, zone)}.`}
              </p>
              <div className="confirm-state">
                <span
                  className={`status-dot ${verified.action === "out" ? "on" : ""}`}
                />
                {verified.action === "out"
                  ? "Currently clocked in"
                  : "Currently clocked out"}
              </div>
              <Notice error={error} />
              <button
                className="button primary wide punch-action"
                disabled={busy}
                onClick={punch}
              >
                <Clock3 size={21} />
                {busy ? "Recording…" : `Clock ${verified.action}`}
                <ArrowRight size={20} />
              </button>
              <p className="secure-caption">
                <ShieldCheck size={14} /> Time is recorded by the server
              </p>
            </>
          ) : (
            <>
              <div className="card-heading">
                <span className="card-icon">
                  <Fingerprint size={25} />
                </span>
                <span className="pill neutral">
                  <LockKeyhole size={12} /> Secure station
                </span>
              </div>
              <h2>Make it official.</h2>
              <p>Enter your employee ID and private PIN.</p>
              <Notice error={error} />
              <form onSubmit={verify} autoComplete="off">
                <div className="credential-fields">
                  <label>
                    Employee ID
                    <input
                      aria-label="Employee ID"
                      inputMode="numeric"
                      pattern="[0-9]{4,10}"
                      value={code}
                      onFocus={() => setActiveInput("code")}
                      onChange={(e) => {
                        setCode(e.target.value.replace(/\D/g, "").slice(0, 10));
                        lastInput.current = Date.now();
                      }}
                      placeholder="Your ID"
                      required
                      autoComplete="off"
                    />
                  </label>
                  <label>
                    Private PIN
                    <input
                      aria-label="Private PIN"
                      type="password"
                      inputMode="numeric"
                      pattern="[0-9]{6,10}"
                      value={pin}
                      onFocus={() => setActiveInput("pin")}
                      onChange={(e) => {
                        setPin(e.target.value.replace(/\D/g, "").slice(0, 10));
                        lastInput.current = Date.now();
                      }}
                      placeholder="6–10 digits"
                      required
                      autoComplete="off"
                    />
                  </label>
                </div>
                <div className="keypad">
                  {["1", "2", "3", "4", "5", "6", "7", "8", "9"].map((n) => (
                    <button type="button" key={n} onClick={() => addDigit(n)}>
                      {n}
                    </button>
                  ))}
                  <button
                    type="button"
                    className="keypad-next"
                    onClick={() =>
                      setActiveInput(activeInput === "code" ? "pin" : "code")
                    }
                  >
                    {activeInput === "code" ? "PIN →" : "← ID"}
                  </button>
                  <button type="button" onClick={() => addDigit("0")}>
                    0
                  </button>
                  <button
                    type="button"
                    aria-label="Delete last digit"
                    onClick={() => addDigit("delete")}
                  >
                    <Delete size={20} />
                  </button>
                </div>
                <button
                  className="button primary wide"
                  disabled={busy || code.length < 4 || pin.length < 6}
                >
                  {busy ? "Checking…" : "Continue"}
                  <ArrowRight size={18} />
                </button>
              </form>
              <p className="secure-caption">
                <ShieldCheck size={14} /> Your session clears after every punch
              </p>
            </>
          )}
        </section>
      </main>
      <footer className="kiosk-footer">
        <span>
          <LockKeyhole size={14} /> Warehouse-only punching
        </span>
        <span>Forgot your PIN? Your manager can reset it.</span>
        <span>{zone.replace("_", " ")}</span>
      </footer>
    </div>
  );
}
