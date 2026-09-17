import { Kiosk } from "@/components/kiosk";
import { demoMode } from "@/lib/env";
export const dynamic = "force-dynamic";
export default function Page() {
  return <Kiosk demo={demoMode()} />;
}
