import { Hours } from "@/components/hours";
import { demoMode } from "@/lib/env";
export const dynamic = "force-dynamic";
export default function Page() {
  return <Hours demo={demoMode()} />;
}
