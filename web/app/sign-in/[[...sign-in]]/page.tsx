import { SignIn } from "@clerk/nextjs";
import { redirect } from "next/navigation";
import { demoMode } from "@/lib/env";
import { cookies } from "next/headers";
export const dynamic = "force-dynamic";
export default async function Page() {
  if ((await cookies()).has("tc-terminal")) redirect("/kiosk");
  if (demoMode()) redirect("/hours");
  return (
    <main className="signin">
      <div className="eyebrow">PATHWAY BOOK SERVICE</div>
      <h1>Your hours. All in one place.</h1>
      <p>Sign in with your approved Pathway Google account.</p>
      <SignIn routing="path" path="/sign-in" forceRedirectUrl="/hours" />
    </main>
  );
}
