import { Admin } from "@/components/admin";
import { demoMode } from "@/lib/env";
export const dynamic = "force-dynamic";
export default function Page() {
  return <Admin demo={demoMode()} />;
}
