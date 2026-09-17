import { clerkMiddleware } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { demoMode } from "./lib/env";

export default demoMode() ? () => NextResponse.next() : clerkMiddleware();
export const config = {
  matcher: [
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|png|svg|woff2?|ico)).*)",
    "/api/(.*)",
  ],
};
