import { auth } from "@clerk/nextjs/server";
import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";
import { demoMode } from "@/lib/env";

export const dynamic = "force-dynamic";
const cookieOptions = {
  httpOnly: true,
  secure: process.env.APP_ENV === "production",
  sameSite: "strict" as const,
  path: "/",
};

async function handler(
  request: NextRequest,
  context: { params: Promise<{ path: string[] }> },
) {
  const { path } = await context.params;
  const endpoint = path.join("/");
  if (path.some((segment) => !/^[a-zA-Z0-9-]+$/.test(segment)))
    return NextResponse.json({ detail: "Invalid route" }, { status: 400 });
  const demo = demoMode();
  if (!["GET", "HEAD"].includes(request.method)) {
    const origin = request.headers.get("origin");
    const localPreviewOrigin =
      demo && origin === `http://${request.headers.get("host")}`;
    if (
      !localPreviewOrigin &&
      (!process.env.APP_ORIGIN || origin !== process.env.APP_ORIGIN)
    ) {
      return NextResponse.json(
        { detail: "Unapproved request origin" },
        { status: 403 },
      );
    }
  }
  const jar = await cookies();
  if (
    !demo &&
    jar.has("tc-terminal") &&
    !endpoint.startsWith("kiosk/") &&
    endpoint !== "config"
  ) {
    return NextResponse.json(
      {
        detail:
          "This is a shared punch station. Use your personal device to view hours or manage the team.",
      },
      { status: 403 },
    );
  }
  if (endpoint === "demo-user" && request.method === "POST") {
    if (!demo)
      return NextResponse.json({ detail: "Not found" }, { status: 404 });
    const body = await request.json();
    if (!["1001", "1002", "1003"].includes(body.code))
      return NextResponse.json(
        { detail: "Unknown preview user" },
        { status: 400 },
      );
    jar.set("tc-demo", body.code, cookieOptions);
    return NextResponse.json({ ok: true });
  }
  const headers = new Headers({
    "x-proxy-secret": process.env.PROXY_SECRET || "",
  });
  if (demo) headers.set("x-demo-user", jar.get("tc-demo")?.value || "1001");
  else if (!endpoint.startsWith("kiosk/") && endpoint !== "config") {
    const session = await auth();
    const jwt = await session.getToken();
    if (!jwt)
      return NextResponse.json(
        { detail: "Please sign in with Google" },
        { status: 401 },
      );
    headers.set("authorization", `Bearer ${jwt}`);
  }
  headers.set("x-terminal-token", jar.get("tc-terminal")?.value || "");
  headers.set("x-kiosk-session", jar.get("tc-punch")?.value || "");
  if (process.env.TRUST_PROXY_IP === "true") {
    headers.set(
      "x-client-ip",
      request.headers.get("x-forwarded-for")?.split(",")[0].trim() || "",
    );
  }
  let body: string | undefined;
  if (!["GET", "HEAD"].includes(request.method)) {
    body = await request.text();
    if (body.length > 16000)
      return NextResponse.json(
        { detail: "Request too large" },
        { status: 413 },
      );
    headers.set("content-type", "application/json");
  }
  try {
    const response = await fetch(
      `${process.env.API_BASE_URL}/v1/${endpoint}${request.nextUrl.search}`,
      {
        method: request.method,
        headers,
        body: body || undefined,
        cache: "no-store",
        signal: AbortSignal.timeout(20000),
      },
    );
    if (response.headers.get("content-type")?.includes("text/csv")) {
      return new NextResponse(await response.text(), {
        status: response.status,
        headers: {
          "Content-Type": "text/csv",
          "Content-Disposition":
            response.headers.get("content-disposition") || "attachment",
          "Cache-Control": "no-store",
        },
      });
    }
    const data = await response.json();
    if (response.ok && data.terminal_token) {
      jar.set("tc-terminal", data.terminal_token, {
        ...cookieOptions,
        maxAge: 30 * 86400,
      });
      delete data.terminal_token;
    }
    if (response.ok && data.session_token) {
      jar.set("tc-punch", data.session_token, { ...cookieOptions, maxAge: 90 });
      delete data.session_token;
    }
    if (endpoint === "kiosk/reset") jar.delete("tc-punch");
    return NextResponse.json(data, {
      status: response.status,
      headers: { "Cache-Control": "no-store" },
    });
  } catch {
    return NextResponse.json(
      {
        detail:
          endpoint === "kiosk/punch"
            ? "Confirmation was interrupted. Retry this same punch to check whether it was recorded."
            : "Cannot reach the time clock. Please try again shortly.",
      },
      { status: 503 },
    );
  }
}
export { handler as GET, handler as POST, handler as PATCH, handler as DELETE };
