import Dashboard from "@/components/Dashboard";
import { getDashboardData } from "@/lib/data";

export const dynamic = "force-dynamic";

export default async function Page() {
  const initial = await getDashboardData();
  return <Dashboard initial={initial} />;
}
