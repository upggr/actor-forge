import { useActionMutation, useActionQuery } from "@agent-native/core/client/hooks";
import { useSetPageTitle } from "@agent-native/toolkit/app-shell";
import { IconHeartbeat } from "@tabler/icons-react";
import { useSearchParams } from "react-router";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

import { BuildDetail } from "./BuildDetail";
import { PLATFORM_LABEL, timeAgo, toastError, useRefreshActions, VerdictPill, WorkingBar } from "./shared";

const COLUMNS: { status: string; label: string }[] = [
  { status: "drafting", label: "Drafting" },
  { status: "awaiting_approval", label: "Awaiting approval" },
  { status: "approved", label: "Approved" },
  { status: "published_dry_run", label: "Published" },
];

export default function PipelinePage() {
  useSetPageTitle("Pipeline");
  const [params, setParams] = useSearchParams();
  const refresh = useRefreshActions();
  const selected = params.get("build");
  const q = useActionQuery("list-builds", {}) as any;
  const builds: any[] = q.data?.builds ?? [];

  const keeper = useActionMutation("keeper-check", {
    onSuccess: (r: any) => {
      refresh();
      toast.success(r.alerts.length ? `Keeper raised ${r.alerts.length} alert(s): ${r.alerts[0].detail}` : `Keeper checked ${r.checked} build(s), no alerts`);
    },
    onError: (e) => toastError(e, "Keeper failed"),
  });

  return (
    <div className="flex h-full min-h-0 flex-col lg:flex-row">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        {keeper.isPending ? (
          <div className="border-b px-4 py-3">
            <WorkingBar label="Keeper is re-vetting builds and re-checking the market" hint="usually under 30 seconds" />
          </div>
        ) : null}
        <div className="flex items-center justify-end gap-3 border-b px-4 py-2.5">
          <Button size="sm" variant="outline" onClick={() => keeper.mutate({})} disabled={keeper.isPending}>
            <IconHeartbeat className="size-4" />
            {keeper.isPending ? "Keeper checking" : "Run Keeper"}
          </Button>
        </div>
        <div className="min-h-0 flex-1 overflow-auto p-4">
          {q.isLoading ? (
            <Skeleton className="h-40 w-full rounded-lg" />
          ) : builds.length === 0 ? (
            <p className="mx-auto mt-16 max-w-sm text-center text-sm text-muted-foreground">
              Nothing in the pipeline. Pick a gap on the Radar and press Build this.
            </p>
          ) : (
            <div className="grid grid-cols-[repeat(auto-fit,minmax(11rem,1fr))] gap-3">
              {COLUMNS.map((col) => {
                const items = builds.filter((b) => b.status === col.status);
                return (
                  <section key={col.status} aria-label={col.label}>
                    <h2 className="mb-2 flex items-center justify-between text-xs font-medium uppercase tracking-wide text-muted-foreground">
                      {col.label}
                      <span className="font-mono">{items.length}</span>
                    </h2>
                    <div className="flex flex-col gap-2">
                      {items.map((b) => (
                        <button
                          key={b.id}
                          onClick={() => setParams(b.id === selected ? {} : { build: b.id })}
                          aria-pressed={b.id === selected}
                          className={cn(
                            "rounded-lg border p-3 text-left transition hover:border-foreground/40",
                            b.id === selected && "border-foreground ring-1 ring-foreground",
                          )}
                        >
                          <div className="text-sm font-medium leading-tight">{b.name}</div>
                          <div className="mt-2 flex items-center justify-between text-xs text-muted-foreground">
                            <span>{PLATFORM_LABEL[b.platform] ?? b.platform}</span>
                            <span>{timeAgo(b.updatedAt)}</span>
                          </div>
                          <div className="mt-2">
                            <VerdictPill verdict={b.vetVerdict} score={b.vetScore} />
                          </div>
                        </button>
                      ))}
                    </div>
                  </section>
                );
              })}
            </div>
          )}
        </div>
      </div>
      {selected ? (
        <aside className="max-h-[60%] w-full shrink-0 overflow-auto border-t bg-background lg:max-h-none lg:w-[26rem] lg:border-l lg:border-t-0" aria-label="Build details">
          <BuildDetail key={selected} id={selected} onClose={() => setParams({})} />
        </aside>
      ) : null}
    </div>
  );
}
