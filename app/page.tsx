import CommandCenter from "./components/CommandCenter";
import ScheduleBoard from "./components/ScheduleBoard";
import VendorPanel from "./components/VendorPanel";
import { listAllDates, loadAllCitiesSummary } from "@/lib/safestorage-api";
import { listVendors } from "@/lib/vendors";

export const dynamic = "force-dynamic";

function fmtDate(d: string) {
  return new Date(d + "T00:00:00Z").toLocaleDateString("en-IN", {
    weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "UTC",
  });
}

export default async function Home({ searchParams }: { searchParams: Promise<{ src?: string; date?: string; view?: string }> }) {
  const sp = await searchParams;
  const view = sp.view ?? "schedule"; // module default landing = Schedule

  // Command Center (multi-city overview) — explicit only
  if (sp.src === "admin") {
    try {
      const dates = await listAllDates();
      const date = sp.date ?? pickDefault(dates);
      const summaries = await loadAllCitiesSummary(date);
      return <CommandCenter summaries={summaries} dateLabel={fmtDate(date)} dates={dates} activeDate={date} />;
    } catch {
      // fall through to the schedule board on failure
    }
  }

  // Module tab: Vendor panel (vendor master)
  if (view === "vendors") {
    const { vendors, source } = await listVendors();
    return <VendorPanel initial={vendors} source={source} />;
  }

  // Module tab: Schedule (tomorrow) and Old schedules (history) share ONE view — only the data differs.
  if (view === "schedule") return <ScheduleBoard mode="tomorrow" />;
  return <ScheduleBoard mode="history" />; // view === "dashboard"
}

function pickDefault(dates: { date: string; count: number }[]): string {
  if (dates.length === 0) return new Date().toISOString().slice(0, 10);
  const today = new Date().toISOString().slice(0, 10);
  const todays = dates.find((d) => d.date === today);
  if (todays) return todays.date;
  return [...dates].sort((a, b) => b.count - a.count)[0].date; // busiest day with data
}
