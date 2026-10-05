"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type Job = {
  id: string;
  name: string;
  title: string;
  cron: string;
  status: string;
  timezone: string;
  task: string;
};

export function OptionalServicesStatus() {
  const [status, setStatus] = useState<{
    design?: { connected?: boolean };
    deployments?: { connected?: boolean };
    social?: { connected?: boolean };
    mcp?: { enabled?: boolean };
  } | null>(null);

  useEffect(() => {
    void fetch("/api/capabilities")
      .then((res) => (res.ok ? res.json() : null))
      .then((body) => setStatus(body))
      .catch(() => setStatus(null));
  }, []);

  if (!status) return null;
  const row = (label: string, connected: boolean) => (
    <div className="flex items-center justify-between text-[12px]">
      <span className="text-[var(--text)]">{label}</span>
      <span className="text-[var(--muted-soft)]">{connected ? "Connected" : "Not connected"}</span>
    </div>
  );
  return (
    <div className="space-y-1.5 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-2.5">
      {row("Design files", !!status.design?.connected)}
      {row("Deployments", !!status.deployments?.connected)}
      {row("Social feed", !!status.social?.connected)}
      {status.mcp?.enabled ? row("Optional tool server", true) : null}
    </div>
  );
}

export function SchedulesPanel({ signedIn }: { signedIn: boolean }) {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [fires, setFires] = useState(false);
  const [title, setTitle] = useState("Morning brief");
  const [prompt, setPrompt] = useState("");
  const [when, setWhen] = useState("every morning");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!signedIn) return;
    const res = await fetch("/api/schedules");
    if (!res.ok) return;
    const body = (await res.json()) as {
      jobs?: Job[];
      fires?: boolean;
      note?: string;
    };
    setJobs(body.jobs ?? []);
    setFires(!!body.fires);
    setNote(body.note ?? null);
  }, [signedIn]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  if (!signedIn) {
    return <p className="text-xs leading-relaxed text-[var(--muted)]">Sign in with cloud storage to schedule a recurring run.</p>;
  }

  return (
    <div className="space-y-3">
      <p className="text-xs leading-relaxed text-[var(--muted)]">Automations run an agent task on the schedule you choose.</p>
      {!fires ? <p className="text-xs text-[var(--muted-soft)]">{note || "Automations need the hosted agent runtime."}</p> : null}
      <div className="space-y-2 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-3">
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Title"
          className="w-full rounded-lg border border-[var(--border)] bg-[var(--canvas)] px-2.5 py-1.5 text-[13px] text-[var(--text)]"
        />
        <textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder="What should the agent do?"
          rows={3}
          className="w-full rounded-lg border border-[var(--border)] bg-[var(--canvas)] px-2.5 py-1.5 text-[13px] text-[var(--text)]"
        />
        <div className="flex flex-wrap gap-2">
          {["every morning", "every weekday morning", "every evening"].map((opt) => (
            <button
              key={opt}
              type="button"
              onClick={() => setWhen(opt)}
              className={cn(
                "rounded-full border px-2.5 py-1 text-[11px]",
                when === opt
                  ? "border-[var(--accent)]/50 bg-[var(--accent-muted)] text-[var(--text)]"
                  : "border-[var(--border)] text-[var(--muted)]",
              )}
            >
              {opt}
            </button>
          ))}
        </div>
        <input
          value={when}
          onChange={(e) => setWhen(e.target.value)}
          aria-label="Schedule or five-field cron"
          placeholder="Or enter a 5-field cron, such as 30 7 * * 1"
          className="w-full rounded-lg border border-[var(--border)] bg-[var(--canvas)] px-2.5 py-1.5 text-[12px] text-[var(--text)]"
        />
        <Button
          type="button"
          size="sm"
          disabled={busy || !fires || !prompt.trim()}
          onClick={() => {
            setBusy(true);
            setError(null);
            setNote(null);
            void (async () => {
              const res = await fetch("/api/schedules", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ title, prompt, when }),
              });
              const body = (await res.json().catch(() => ({}))) as { error?: string; note?: string };
              if (!res.ok) setError(body.error || "Could not save.");
              else {
                setNote(body.note || "Saved as a recurring run.");
                setPrompt("");
                await refresh();
              }
              setBusy(false);
            })();
          }}
        >
          Schedule
        </Button>
        {error ? <p className="text-xs text-[var(--error-text)]">{error}</p> : null}
        {note && fires ? <p className="text-xs text-[var(--muted)]">{note}</p> : null}
      </div>
      {jobs.length > 0 ? (
        <ul className="space-y-2">
          {jobs.map((job) => (
            <li key={job.id} className="flex items-center justify-between gap-2 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-2">
              <div className="min-w-0">
                <div className="truncate text-[13px] text-[var(--text)]">{job.title}</div>
                <div className="text-[11px] text-[var(--muted-soft)]">{job.cron} · {job.timezone} · {job.status}</div>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <button
                  type="button"
                  className="text-xs text-[var(--muted)] hover:underline"
                  onClick={() => {
                    void (async () => {
                      await fetch("/api/schedules", {
                        method: "PATCH",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ id: job.id, status: job.status === "paused" ? "active" : "paused" }),
                      });
                      await refresh();
                    })();
                  }}
                >
                  {job.status === "paused" ? "Resume" : "Pause"}
                </button>
                <button
                  type="button"
                  className="text-xs text-[var(--muted)] hover:underline"
                  onClick={() => {
                    void (async () => {
                      await fetch(`/api/schedules?id=${encodeURIComponent(job.id)}`, { method: "DELETE" });
                      await refresh();
                    })();
                  }}
                >
                  Remove
                </button>
              </div>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
