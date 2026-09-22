export async function api<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch("/api/" + path, {
    ...options,
    cache: "no-store",
    headers: { "Content-Type": "application/json", ...options?.headers },
  });
  const body = await response.json().catch(() => null);
  if (!response.ok || body === null) {
    const message = Array.isArray(body?.detail)
      ? body.detail.map((e: { msg: string }) => e.msg).join(". ")
      : body?.detail;
    throw new Error(message || "Something went wrong. Please try again.");
  }
  return body;
}
export const send = <T>(path: string, body: unknown, method = "POST") =>
  api<T>(path, { method, body: JSON.stringify(body) });
export function duration(seconds: number) {
  const minutes = Math.floor(Math.max(0, seconds) / 60);
  return `${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, "0")}m`;
}
export function time(value: string | null, zone: string) {
  return value
    ? new Intl.DateTimeFormat("en-US", {
        hour: "numeric",
        minute: "2-digit",
        timeZone: zone,
      }).format(new Date(value))
    : "—";
}
export function day(value: string, zone = "UTC") {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    timeZone: zone,
  }).format(new Date(value));
}
export type Employee = {
  id: string;
  employee_code: string;
  name: string;
  email: string;
  active: boolean;
  manager: boolean;
};
export type Shift = {
  id: string;
  started_at: string;
  ended_at: string | null;
  version: number;
  adjusted: boolean;
};
export type Report = {
  shifts: Shift[];
  daily: { date: string; seconds: number }[];
  total_seconds: number;
  open_shift: Shift | null;
  from: string;
  to: string;
};
export type Settings = {
  demo: boolean;
  timezone: string;
  period_days: number;
  period_anchor: string;
  server_time: string;
};
export type Correction = {
  id: string;
  employee_id: string;
  shift_id: string | null;
  name: string;
  reason: string;
  proposed_start: string;
  proposed_end: string | null;
  status: string;
  resolution_reason: string | null;
  version: number | null;
};
