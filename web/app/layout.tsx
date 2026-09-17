import type { Metadata } from "next";
import { GeistSans } from "geist/font/sans";
import { GeistMono } from "geist/font/mono";
import { ClerkProvider } from "@clerk/nextjs";
import { demoMode } from "@/lib/env";
import "./globals.css";

export const metadata: Metadata = {
  title: "Time Clock · Pathway",
  description: "Your workday, accurately recorded.",
  robots: { index: false, follow: false },
};
export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const content = (
    <html
      lang="en"
      className={`${GeistSans.variable} ${GeistMono.variable}`}
      suppressHydrationWarning
    >
      <body>{children}</body>
    </html>
  );
  return demoMode() ? content : <ClerkProvider>{content}</ClerkProvider>;
}
