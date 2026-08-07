"use client";

// Retrieval → Calls. Retrieval calls land on the SR number (+91 95134 46259) via extension 2,1;
// this page will list them the way the Emails tab lists mail. The provider integration is not
// wired yet — see the note below for exactly what is missing.
import { SessionUser } from "@/lib/auth";
import AppShell from "./AppShell";
import { Card } from "./ui";

export default function CallsBoard({ user }: { user: SessionUser | null }) {
  return (
    <AppShell active="calls" user={user}>
      <header className="mb-4">
        <h1 className="text-lg font-bold text-slate-900">Calls</h1>
        <p className="text-xs text-slate-500">
          retrieval calls on +91 95134 46259 · extension 2,1
        </p>
      </header>

      <Card className="p-6">
        <div className="mb-3 text-sm font-semibold text-slate-800">Waiting on one detail from the telephony provider</div>
        <p className="mb-3 text-sm leading-relaxed text-slate-600">
          The credentials are in hand (authorisation key, API key, SR number and the retrieval
          extension), but the provider&apos;s <b>API address</b> is still needed — the name given
          doesn&apos;t resolve to a public site, so the endpoint can&apos;t be discovered from here.
        </p>
        <div className="mb-3 rounded-lg bg-slate-50 p-3 text-[12px] text-slate-600">
          <div className="mb-1 font-semibold text-slate-700">What to ask them for</div>
          <ul className="ml-4 list-disc space-y-1">
            <li>The base URL of the call-logs API (e.g. <code>https://…/v1/calls</code>)</li>
            <li>How the two keys are sent — header names and format</li>
            <li>Which parameters filter by date range and extension</li>
            <li>A sample response, so the columns can be mapped correctly</li>
            <li>Whether call recordings are returned as a URL</li>
          </ul>
        </div>
        <p className="text-sm leading-relaxed text-slate-600">
          Once that arrives, this page will list every retrieval call — caller, number, time,
          duration, answered or missed, the agent who took it, and a link to the recording — matched
          to the customer the same way the Emails tab does, and pulled on the same hourly schedule.
        </p>
      </Card>
    </AppShell>
  );
}
