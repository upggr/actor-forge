import { actionErrorMessage, useActionMutation, useActionQuery } from "@agent-native/core/client/hooks";
import { useSetPageTitle } from "@agent-native/toolkit/app-shell";
import { IconCoin, IconKey } from "@tabler/icons-react";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

import { toastError, useRefreshActions, WorkingBar } from "./shared";

const KIND_LABEL: Record<string, string> = { pricing: "Pricing", feature: "Feature", fix: "Fix" };

function ReportView({ platform, report }: { platform: string; report: any }) {
  const q = useActionQuery("run-report", { platform, report: report.id }, { retry: false }) as any;
  const data = q.data;
  const message = q.error ? actionErrorMessage(q.error) : null;
  const needsToken = Boolean(message && /Settings, API keys|rejected the token/i.test(message));
  const maxBar = Math.max(1, ...((data?.bars ?? []).map((b: any) => b.y)));
  return (
    <section aria-label={report.title} className="rounded-lg border p-4">
      <h3 className="text-sm font-semibold">{report.title}</h3>
      {report.description ? <p className="mt-0.5 text-xs text-muted-foreground">{report.description}</p> : null}
      <div className="mt-3">
        {report.type === "link" ? (
          <a href={report.href ?? "#"} target="_blank" rel="noreferrer" className="text-sm underline underline-offset-2">
            {report.linkLabel ?? "Open"}
          </a>
        ) : q.isLoading ? (
          <Skeleton className="h-16 w-full" />
        ) : message ? (
          <p className="text-sm text-muted-foreground">
            {message}{" "}
            {needsToken ? (
              <a href="/settings/api-keys" className="underline underline-offset-2">Open Settings</a>
            ) : (
              <button onClick={() => q.refetch()} className="underline underline-offset-2">Retry</button>
            )}
          </p>
        ) : data?.stats ? (
          <dl className="grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-3">
            {data.stats.map((s: any) => (
              <div key={s.label}>
                <dd className="font-mono text-xl font-semibold tabular-nums">{s.display}</dd>
                <dt className="text-xs text-muted-foreground">{s.label}</dt>
              </div>
            ))}
          </dl>
        ) : data?.rows ? (
          data.rows.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nothing to show yet.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-left text-xs text-muted-foreground">
                  <tr>{data.columns.map((c: string) => <th key={c} className="py-1 pr-4 font-medium">{c}</th>)}</tr>
                </thead>
                <tbody className="divide-y">
                  {data.rows.map((row: string[], i: number) => (
                    <tr key={i}>{row.map((cell, j) => <td key={j} className="py-1.5 pr-4 tabular-nums">{cell}</td>)}</tr>
                  ))}
                </tbody>
              </table>
              {data.total > data.rows.length ? <p className="mt-1 text-xs text-muted-foreground">Showing {data.rows.length} of {data.total}</p> : null}
            </div>
          )
        ) : data?.bars ? (
          data.bars.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nothing to show yet.</p>
          ) : (
            <div className="flex h-24 items-end gap-0.5" role="img" aria-label={`${report.title}: ${data.bars.map((b: any) => `${b.x} ${b.display}`).join(", ")}`}>
              {data.bars.map((b: any) => (
                <div key={b.x} title={`${b.x}: ${b.display}`} className="min-w-1 flex-1 rounded-t bg-foreground/70" style={{ height: `${Math.max(2, (b.y / maxBar) * 100)}%` }} />
              ))}
            </div>
          )
        ) : null}
      </div>
    </section>
  );
}

export default function PortfolioPage() {
  const [platform, setPlatform] = useState<string>("apify");
  const platformsQ = useActionQuery("list-platforms", {}) as any;
  const withReports: any[] = (platformsQ.data?.platforms ?? []).filter((p: any) => p.enabled && p.reports?.length);
  const active = withReports.find((p) => p.id === platform) ?? withReports[0];
  // One token problem is shown once for the whole panel instead of on every card (same query key, so no extra request).
  const probe = active?.reports.find((r: any) => r.needsToken);
  const probeQ = useActionQuery("run-report", { platform: active?.id ?? "", report: probe?.id ?? "" }, { enabled: Boolean(probe), retry: false }) as any;
  const probeMessage = probeQ.error ? actionErrorMessage(probeQ.error) : null;
  const tokenProblem = Boolean(probeMessage && /Settings, API keys|rejected the token/i.test(probeMessage));
  useSetPageTitle("Portfolio");
  const refresh = useRefreshActions();
  const actorsQ = useActionQuery("list-my-actors", {}, { retry: false }) as any;
  const suggestionsQ = useActionQuery("list-suggestions", {}) as any;
  const actors: any[] = actorsQ.data?.actors ?? [];
  const suggestions: any[] = suggestionsQ.data?.suggestions ?? [];

  const pricing = useActionMutation("pricing-check", {
    onSuccess: (r: any) => {
      refresh();
      const flagged = r.results.filter((x: any) => x.suggestion).length;
      toast.success(`Checked ${r.checked} actor(s) against the Store, ${flagged} pricing suggestion(s)`);
    },
    onError: (e) => toastError(e, "Pricing check failed"),
  });
  const decide = useActionMutation("decide-suggestion", { onSuccess: () => refresh(), onError: (e) => toastError(e, "Could not save") });

  const message = actorsQ.error ? actionErrorMessage(actorsQ.error) : null;
  const notConnected = Boolean(message && /APIFY_TOKEN|Connect Apify|rejected/i.test(message));

  return (
    <div className="h-full overflow-auto p-4">
      <div className="mx-auto flex max-w-3xl flex-col gap-6">
        <div role="tablist" aria-label="Platform" className="flex gap-1">
          {withReports.map((p) => (
            <button
              key={p.id}
              role="tab"
              aria-selected={active?.id === p.id}
              onClick={() => setPlatform(p.id)}
              className={cn("rounded-md px-2.5 py-1 text-sm transition-colors", active?.id === p.id ? "bg-accent font-medium" : "text-muted-foreground hover:bg-accent/60")}
            >
              {p.name}
            </button>
          ))}
        </div>

        {active ? (
          <div className="flex flex-col gap-3">
            {tokenProblem ? (
              <div className="rounded-lg border p-4 text-sm">
                <p className="font-medium">{probeMessage}</p>
                <a href="/settings/api-keys" className="mt-1 inline-block underline underline-offset-2">Open Settings, API keys</a>
              </div>
            ) : null}
            {active.reports
              .filter((r: any) => !tokenProblem || !r.needsToken)
              .map((r: any) => <ReportView key={`${active.id}-${r.id}`} platform={active.id} report={r} />)}
          </div>
        ) : null}

        {active?.id !== "apify" ? null : notConnected && tokenProblem ? null : notConnected ? (
          <div className="rounded-lg border p-6 text-center">
            <IconKey className="mx-auto size-7 text-muted-foreground" strokeWidth={1.5} />
            <p className="mt-3 text-sm font-medium">Connect Apify to manage your actors</p>
            <p className="mt-1 text-sm text-muted-foreground">{message}</p>
            <a href="/settings/api-keys" className="mt-4 inline-block text-sm underline underline-offset-2">Open Settings, API keys</a>
          </div>
        ) : (
          <section aria-label="Actors">
            <div className="mb-2 flex items-center justify-between">
              <h2 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Your actors</h2>
              <Button size="sm" variant="outline" onClick={() => pricing.mutate({})} disabled={pricing.isPending || actorsQ.isLoading}>
                <IconCoin className="size-4" />
                {pricing.isPending ? "Comparing prices" : "Run pricing check"}
              </Button>
            </div>
            {pricing.isPending ? (
              <div className="mb-3">
                <WorkingBar label="Comparing each actor with its competitors in the Apify Store" hint="about 5 seconds per actor" />
              </div>
            ) : null}
            {actorsQ.isLoading ? (
              <Skeleton className="h-40 w-full rounded-lg" />
            ) : message ? (
              <p className="rounded-lg border p-4 text-sm text-muted-foreground">{message}</p>
            ) : actors.length === 0 ? (
              <p className="rounded-lg border p-4 text-sm text-muted-foreground">No actors found on this Apify account.</p>
            ) : (
              <div className="overflow-x-auto rounded-lg border">
                <table className="w-full text-sm">
                  <thead className="border-b text-left text-xs text-muted-foreground">
                    <tr>
                      <th className="px-3 py-2 font-medium">Actor</th>
                      <th className="px-3 py-2 text-right font-medium">Users 30d</th>
                      <th className="px-3 py-2 text-right font-medium">Failed</th>
                      <th className="px-3 py-2 font-medium">Price</th>
                      <th className="px-3 py-2 font-medium">Issues</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {actors.map((a) => (
                      <tr key={a.id}>
                        <td className="px-3 py-2">
                          <a href={a.url} target="_blank" rel="noreferrer" className="font-medium hover:underline">{a.title ?? a.name}</a>
                          {!a.isPublic ? <span className="ml-2 text-xs text-muted-foreground">private</span> : null}
                        </td>
                        <td className="px-3 py-2 text-right font-mono tabular-nums">{a.users30d}</td>
                        <td className={cn("px-3 py-2 text-right font-mono tabular-nums", a.failRate30d > 0.2 && "text-destructive")}>
                          {a.failRate30d === null ? "–" : `${Math.round(a.failRate30d * 100)}%`}
                        </td>
                        <td className="px-3 py-2 text-muted-foreground">{a.pricing ?? "–"}</td>
                        <td className="px-3 py-2 text-xs">{a.issues.length ? a.issues.join("; ") : <span className="text-muted-foreground">none</span>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        )}

        <section aria-label="Suggestions">
          <h2 className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">Suggestions waiting for you</h2>
          {suggestionsQ.isLoading ? (
            <Skeleton className="h-24 w-full rounded-lg" />
          ) : suggestions.length === 0 ? (
            <p className="rounded-lg border p-4 text-sm text-muted-foreground">
              Nothing yet. The scheduled agent proposes price changes and features here, each with its evidence, and only you can accept them.
            </p>
          ) : (
            <ul className="flex flex-col gap-3">
              {suggestions.map((s) => (
                <li key={s.id} className="rounded-lg border p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="text-xs text-muted-foreground">{KIND_LABEL[s.kind] ?? s.kind} · {s.actorName}</div>
                      <h3 className="text-sm font-semibold">{s.title}</h3>
                    </div>
                    <div className="flex shrink-0 gap-2">
                      <Button size="sm" onClick={() => decide.mutate({ id: s.id, decision: "accept" })} disabled={decide.isPending}>Accept</Button>
                      <Button size="sm" variant="ghost" onClick={() => decide.mutate({ id: s.id, decision: "dismiss" })} disabled={decide.isPending}>Dismiss</Button>
                    </div>
                  </div>
                  <p className="mt-2 text-sm">{s.rationale}</p>
                  {s.evidence?.competitors?.length ? (
                    <ul className="mt-2 space-y-0.5 text-xs text-muted-foreground">
                      {s.evidence.competitors.map((c: any) => (
                        <li key={c.url}>
                          <a href={c.url} target="_blank" rel="noreferrer" className="hover:underline">{c.title}</a>
                          {c.price !== null ? ` · $${c.price} per 1,000` : ""} · {c.users30d} users
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}
