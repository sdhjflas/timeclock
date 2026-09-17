"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { UserButton } from "@clerk/nextjs";
import {
  BookOpen,
  Clock3,
  BarChart3,
  UsersRound,
  Sun,
  Moon,
  ArrowUpRight,
  ShieldCheck,
} from "lucide-react";
import { send } from "@/lib/client";

export function Brand() {
  return (
    <Link className="brand" href="/kiosk">
      <span className="brand-mark">
        <BookOpen size={23} strokeWidth={1.5} />
      </span>
      <span>
        Pathway<span className="brand-sub">BOOK SERVICE</span>
      </span>
    </Link>
  );
}
export function ThemeToggle() {
  const [dark, setDark] = useState(false);
  useEffect(() => {
    const value = localStorage.getItem("pbs-theme") === "dark";
    setDark(value);
    document.documentElement.classList.toggle("dark", value);
  }, []);
  return (
    <button
      className="icon-button"
      aria-label="Toggle color theme"
      onClick={() => {
        localStorage.setItem("pbs-theme", dark ? "light" : "dark");
        document.documentElement.classList.toggle("dark", !dark);
        setDark(!dark);
      }}
    >
      {dark ? <Sun size={18} /> : <Moon size={18} />}
    </button>
  );
}
export function Shell({
  children,
  demo,
  name,
  manager = false,
}: {
  children: React.ReactNode;
  demo: boolean;
  name?: string;
  manager?: boolean;
}) {
  const path = usePathname();
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <Brand />
        <div className="workspace">
          <span className="workspace-icon">
            <Clock3 size={18} />
          </span>
          <div>
            Time Clock<small>Pathway workspace</small>
          </div>
          <span className="version">01</span>
        </div>
        <div className="nav-label">WORKSPACE</div>
        <nav>
          <Link className={path === "/hours" ? "active" : ""} href="/hours">
            <BarChart3 size={18} /> My hours
          </Link>
          {manager && (
            <Link className={path === "/admin" ? "active" : ""} href="/admin">
              <UsersRound size={18} /> Team overview
            </Link>
          )}
          <Link href="/kiosk">
            <Clock3 size={18} /> Punch station
            <ArrowUpRight size={14} className="push-right" />
          </Link>
        </nav>
        <div className="sidebar-bottom">
          <div className="trust-note">
            <ShieldCheck size={17} />
            <span>
              Accurately recorded.
              <br />
              Always yours to review.
            </span>
          </div>
          <div className="identity">
            <span className="avatar">
              {(name || "P")
                .split(" ")
                .map((s) => s[0])
                .slice(0, 2)
                .join("")}
            </span>
            <div>
              {name || "Pathway employee"}
              <small>{manager ? "Time manager" : "Employee workspace"}</small>
            </div>
            {!demo && <UserButton />}
          </div>
        </div>
      </aside>
      <div className="main-wrap">
        <header className="topbar">
          <span>
            Workspace <span className="slash">/</span>{" "}
            <strong>{path === "/admin" ? "Team overview" : "My hours"}</strong>
          </span>
          <div className="topbar-actions">
            {demo && (
              <label className="demo-control">
                <span>PREVIEW</span>
                <select
                  aria-label="Preview identity"
                  defaultValue=""
                  onChange={async (e) => {
                    await send("demo-user", { code: e.target.value });
                    window.location.reload();
                  }}
                >
                  <option value="" disabled>
                    Switch employee
                  </option>
                  <option value="1001">Alex · employee</option>
                  <option value="1002">Jordan · manager</option>
                  <option value="1003">Casey · employee</option>
                </select>
              </label>
            )}
            <ThemeToggle />
          </div>
        </header>
        {demo && (
          <div className="demo-strip">
            Local preview · Sample employees and hours · Changes stay in the
            development database
          </div>
        )}
        <main className="content">{children}</main>
        <footer className="page-footer">
          <span>PATHWAY BOOK SERVICE</span>
          <span>Time well accounted for.</span>
        </footer>
      </div>
    </div>
  );
}
export function Notice({ error }: { error: string }) {
  return error ? (
    <div role="alert" className="error">
      {error}
    </div>
  ) : null;
}
export function Loading() {
  return (
    <div className="loading" role="status">
      <span className="spinner" />
      Loading your workspace…
    </div>
  );
}
