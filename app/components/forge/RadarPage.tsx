import { useActionMutation, useActionQuery } from "@agent-native/core/client/hooks";
import { useSetPageTitle } from "@agent-native/toolkit/app-shell";
import { IconHammer, IconRadar2, IconX } from "@tabler/icons-react";
import { useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

import { PLATFORM_LABEL, timeAgo, toastError, useRefreshActions } from "./shared";

interface Opportunity {
  id: string;
  platform: string;
  topic: string;
  query: string;
  score: number;
  summary: string;
  status: string;
  evidence: any;
  updatedAt: string;
}

function supplyLine(o: Opportunity): string {
  const e = o.evidence ?? {};
  if (e.type === "apify-store")
    return e.leader ? `Leader: ${e.leader.users30d} users / 30d` : "No actor yet";
  if (e.type === "hf-spaces") return e.matchingSpaces ? `${e.matchingSpaces} Spaces, best ${e.bestSpace?.likes ?? 0} likes` : "No Space yet";
  if (e.type === "npm-search") {
    const n = (e.packages?.length ?? 0) + (e.builtinNodes?.length ?? 0);
    return e.builtinNodes?.length ? "Built into host app" : n === 0 ? `No ${e.marker} node yet` : `${n} existing package${n === 1 ? "" : "s"}`;
  }
  const n = (e.npmMcpPackages?.length ?? 0) + (e.registryEntries ?? 0);
  return n === 0 ? "No MCP server yet" : `${n} existing server${n === 1 ? "" : "s"}`;
}

/** Compact card: warm tint and a slim bar carry the gap score, so rows stay dense and scannable. */
function Tile({ o, selected, onSelect }: { o: Opportunity; selected: boolean; onSelect: () => void }) {
  const building = o.status === "building";
  const heat = building ? 0.04 : 0.06 + (o.score / 100) * 0.26;
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      style={{
        backgroundColor: `hsl(38 95% 52% / ${heat})`,
        borderColor: `hsl(38 95% 45% / ${building ? 0.2 : 0.2 + (o.score / 100) * 0.45})`,
      }}
      className={cn(
        "flex min-w-0 flex-col rounded-lg border px-3 py-2.5 text-left transition",
        "hover:brightness-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring dark:hover:brightness-110",
        selected && "ring-2 ring-foreground",
        building && "opacity-60",
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <span className="line-clamp-2 text-sm font-semibold leading-snug">{o.topic}</span>
        <span className="font-mono text-base font-semibold leading-snug tabular-nums">{o.score}</span>
      </div>
      <div className="mt-1 flex items-center justify-between gap-2 text-xs text-foreground/70">
        <span className="shrink-0 font-medium text-foreground">{PLATFORM_LABEL[o.platform] ?? o.platform}</span>
        <span className="truncate">{building ? "building" : supplyLine(o)}</span>
      </div>
      <div className="mt-2 h-1 w-full overflow-hidden rounded-full bg-foreground/10" aria-hidden="true">
        <div className="h-full rounded-full bg-amber-500" style={{ width: `${o.score}%` }} />
      </div>
    </button>
  );
}

function Evidence({ o }: { o: Opportunity }) {
  const e = o.evidence ?? {};
  const rows: [string, string][] =
    e.type === "apify-store"
      ? [
          ["Matching actors", String(e.matchingActors)],
          ["Category demand", `${(e.categoryUsers30d ?? 0).toLocaleString()} users / 30d${e.category ? ` (${e.category})` : ""}`],
          ["Leader", e.leader ? `${e.leader.title}` : "none"],
          ["Leader usage", e.leader ? `${e.leader.users30d} users / 30d${e.leader.rating ? `, ${e.leader.rating.toFixed(1)} stars` : ""}` : "none"],
        ]
      : e.type === "hf-spaces"
        ? [
            ["Matching Spaces", String(e.matchingSpaces)],
            ["Best Space", e.bestSpace ? `${e.bestSpace.id} (${e.bestSpace.likes} likes)` : "none"],
            ["Related model downloads", (e.relatedModelDownloads ?? 0).toLocaleString()],
          ]
        : e.type === "npm-search"
          ? [
              ["Built-in nodes", e.builtinNodes?.length ? e.builtinNodes.join(", ") : "none"],
              ["Community packages", String(e.packages?.length ?? 0)],
              ["Best existing", e.packages?.[0] ? `${e.packages[0].name} (${e.packages[0].weekly}/wk)` : "none"],
              ["Related package downloads", `${(e.relatedPackageDownloads30d ?? 0).toLocaleString()} / month`],
            ]
          : [
          ["npm MCP packages", String(e.npmMcpPackages?.length ?? 0)],
          ["Registry servers", String(e.registryEntries ?? 0)],
          ["Related package downloads", `${(e.relatedPackageDownloads30d ?? 0).toLocaleString()} / month`],
          ["Best existing", e.npmMcpPackages?.[0] ? `${e.npmMcpPackages[0].name} (${e.npmMcpPackages[0].weekly}/wk)` : "none"],
        ];
  return (
    <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
      {rows.map(([k, v]) => (
        <div key={k} className="contents">
          <dt className="text-muted-foreground">{k}</dt>
          <dd className="break-words font-medium">{v}</dd>
        </div>
      ))}
    </dl>
  );
}

export default function RadarPage() {
  useSetPageTitle("Radar");
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const refresh = useRefreshActions();
  const [platform, setPlatform] = useState<string>("all");
  const selectedId = params.get("opportunity");

  const platforms = useActionQuery("list-platforms", {}) as any;
  const query = useActionQuery("list-opportunities", platform === "all" ? {} : { platform }) as any;
  const opportunities: Opportunity[] = query.data?.opportunities ?? [];
  const selected = opportunities.find((o) => o.id === selectedId) ?? null;
  const newest = opportunities.reduce((m, o) => (o.updatedAt > m ? o.updatedAt : m), "");

  // Scout runs one niche per request so the bar is real and tiles appear as each result lands.
  const scoutM = useActionMutation("scout-run");
  const [progress, setProgress] = useState<null | { done: number; total: number; failed: number; per: Record<string, { name: string; done: number; total: number }> }>(null);
  const running = useRef(false);
  const scouting = progress !== null;

  const runScout = async () => {
    const list: any[] = (platforms.data?.platforms ?? []).filter((p: any) => p.enabled);
    if (running.current || !list.length) return;
    running.current = true;
    const per: Record<string, { name: string; done: number; total: number }> = {};
    for (const p of list) per[p.id] = { name: p.name, done: 0, total: p.seedTopics.length };
    let done = 0;
    let failed = 0;
    const total = list.reduce((n, p) => n + p.seedTopics.length, 0);
    const publish = () => setProgress({ done, total, failed, per: JSON.parse(JSON.stringify(per)) });
    publish();
    const lane = async (p: any) => {
      const queue: string[] = [...p.seedTopics];
      const worker = async () => {
        for (let topic = queue.shift(); topic !== undefined; topic = queue.shift()) {
          try {
            const r: any = await scoutM.mutateAsync({ platform: p.id, topic });
            failed += r.summary.reduce((n: number, x: any) => n + x.failures.length, 0);
          } catch {
            failed += 1;
          }
          done += 1;
          per[p.id]!.done += 1;
          publish();
          refresh();
        }
      };
      await Promise.all(Array.from({ length: p.scoutConcurrency ?? 1 }, worker));
    };
    await Promise.all(list.map(lane));
    running.current = false;
    refresh();
    toast[failed ? "warning" : "success"](`Scout checked ${total - failed} of ${total} niches${failed ? `, ${failed} could not be checked` : ""}`);
    setTimeout(() => setProgress(null), 1200);
  };
  const build = useActionMutation("start-build", {
    onSuccess: (r: any) => {
      refresh();
      navigate(`/pipeline?build=${r.id}`);
    },
    onError: (e) => toastError(e, "Could not start the build"),
  });
  const dismiss = useActionMutation("dismiss-opportunity", {
    onSuccess: () => {
      refresh();
      setParams({});
    },
    onError: (e) => toastError(e, "Could not dismiss"),
  });

  const select = (id: string | null) => setParams(id ? { opportunity: id } : {});
  const ids: string[] = (platforms.data?.platforms ?? []).filter((p: any) => p.enabled).map((p: any) => p.id);

  return (
    <div className="flex h-full min-h-0 flex-col md:flex-row">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <div className="flex items-center gap-2 border-b px-3 py-2 sm:px-4">
          <div role="tablist" aria-label="Platform" className="flex min-w-0 gap-1 overflow-x-auto [scrollbar-width:none]">
            {["all", ...ids].map((id) => (
              <button
                key={id}
                role="tab"
                aria-selected={platform === id}
                onClick={() => setPlatform(id)}
                className={cn(
                  "shrink-0 whitespace-nowrap rounded-md px-2.5 py-1 text-sm transition-colors",
                  platform === id ? "bg-accent font-medium" : "text-muted-foreground hover:bg-accent/60",
                )}
              >
                {id === "all" ? "All" : (PLATFORM_LABEL[id] ?? id)}
              </button>
            ))}
          </div>
          <div className="ml-auto flex shrink-0 items-center gap-3">
            {newest ? <span className="hidden text-xs text-muted-foreground md:inline">Updated {timeAgo(newest)}</span> : null}
            <Button size="sm" onClick={runScout} disabled={scouting || !platforms.data}>
              <IconRadar2 className={cn("size-4", scouting && "motion-safe:animate-spin")} />
              {scouting ? "Scouting" : "Run Scout"}
            </Button>
          </div>
        </div>

        {progress ? (
          <div className="border-b px-4 py-3" role="status" aria-live="polite">
            <div className="mb-1.5 flex items-baseline justify-between text-sm">
              <span className="font-medium">Scouting live data</span>
              <span className="font-mono text-xs tabular-nums text-muted-foreground">
                {progress.done} of {progress.total} niches
              </span>
            </div>
            <Progress value={(progress.done / Math.max(1, progress.total)) * 100} aria-label="Scout progress" />
            <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
              {Object.entries(progress.per).map(([id, p]) => (
                <li key={id} className={cn(p.done === p.total && "text-foreground")}>
                  {p.name} <span className="font-mono tabular-nums">{p.done}/{p.total}</span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
        <div className="min-h-0 flex-1 overflow-auto p-3 sm:p-4">
          {query.isLoading ? (
            <div className="grid grid-cols-[repeat(auto-fill,minmax(12.5rem,1fr))] gap-2">
              {Array.from({ length: 12 }).map((_, i) => (
                <Skeleton key={i} className="h-[4.75rem] rounded-lg" />
              ))}
            </div>
          ) : opportunities.length === 0 ? (
            <div className="mx-auto mt-16 max-w-sm text-center">
              <IconRadar2 className="mx-auto size-8 text-muted-foreground" strokeWidth={1.5} />
              <p className="mt-3 text-sm font-medium">No gaps yet</p>
              <p className="mt-1 text-sm text-muted-foreground">
                Scout queries the live Apify Store, npm and MCP registry and ranks niches with demand and weak supply.
              </p>
              <Button className="mt-4" onClick={runScout} disabled={scouting || !platforms.data}>
                Run Scout
              </Button>
            </div>
          ) : (
            <div className="grid grid-cols-[repeat(auto-fill,minmax(12.5rem,1fr))] gap-2">
              {opportunities.map((o) => (
                <Tile key={o.id} o={o} selected={o.id === selectedId} onSelect={() => select(o.id === selectedId ? null : o.id)} />
              ))}
            </div>
          )}
        </div>
      </div>

      {selected ? (
        <aside className="w-full shrink-0 overflow-auto border-t bg-background p-4 md:w-80 md:border-l md:border-t-0" aria-label="Opportunity details">
          <div className="flex items-start justify-between gap-2">
            <div>
              <div className="text-xs text-muted-foreground">{PLATFORM_LABEL[selected.platform] ?? selected.platform}</div>
              <h2 className="text-base font-semibold leading-tight">{selected.topic}</h2>
            </div>
            <button aria-label="Close details" onClick={() => select(null)} className="rounded p-1 text-muted-foreground hover:bg-accent">
              <IconX className="size-4" />
            </button>
          </div>
          <div className="mt-3 flex items-baseline gap-2">
            <span className="font-mono text-3xl font-semibold tabular-nums">{selected.score}</span>
            <span className="text-xs text-muted-foreground">gap score</span>
          </div>
          <p className="mt-2 text-sm">{selected.summary}</p>
          <div className="mt-4 border-t pt-4">
            <Evidence o={selected} />
          </div>
          <div className="mt-5 flex gap-2">
            <Button
              className="flex-1"
              onClick={() => build.mutate({ opportunityId: selected.id })}
              disabled={selected.status !== "open" || build.isPending}
            >
              <IconHammer className="size-4" />
              {selected.status === "building" ? "Already building" : "Build this"}
            </Button>
            {selected.status === "open" ? (
              <Button variant="ghost" onClick={() => dismiss.mutate({ id: selected.id })} disabled={dismiss.isPending}>
                Dismiss
              </Button>
            ) : null}
          </div>
        </aside>
      ) : null}
    </div>
  );
}
