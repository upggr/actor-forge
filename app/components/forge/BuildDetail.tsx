import { useActionMutation, useActionQuery } from "@agent-native/core/client/hooks";
import { IconCircleCheck, IconFlask, IconPackageExport, IconSend, IconX } from "@tabler/icons-react";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

import { CheckRow, PLATFORM_LABEL, timeAgo, toastError, useRefreshActions, VerdictPill, WorkingBar, type VetReport } from "./shared";

/** One build: evidence, files, the real vetting report and the next step for its state. */
export function BuildDetail({ id, onClose, compact = false }: { id: string; onClose?: () => void; compact?: boolean }) {
  const refresh = useRefreshActions();
  const [file, setFile] = useState<string | undefined>();
  const [note, setNote] = useState("");
  const q = useActionQuery("get-build", file ? { id, file } : { id }) as any;
  const b = q.data;
  const vet: VetReport | null = b?.vet ?? null;

  const done = (msg?: string) => () => {
    refresh();
    if (msg) toast.success(msg);
  };
  const vetM = useActionMutation("vet-build", { onSuccess: done(), onError: (e) => toastError(e, "Vetting failed to run") });
  const askM = useActionMutation("request-approval", { onSuccess: done("Sent to the approval queue"), onError: (e) => toastError(e, "Could not request approval") });
  const decideM = useActionMutation("decide-build", {
    onSuccess: (_r: any, v: any) => {
      setNote("");
      done(v.decision === "approve" ? "Approved" : "Sent back to drafting")();
    },
    onError: (e) => toastError(e, "Could not record the decision"),
  });
  const publishM = useActionMutation("publish-build", { onSuccess: done("Dry-run publish recorded"), onError: (e) => toastError(e, "Publish failed") });

  if (q.isLoading || !b) {
    return (
      <div className="space-y-3 p-4">
        <Skeleton className="h-6 w-2/3" />
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }

  const busy = vetM.isPending || askM.isPending || decideM.isPending || publishM.isPending;
  return (
    <div className={cn("flex flex-col gap-5", compact ? "p-4" : "p-4")}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="text-xs text-muted-foreground">{PLATFORM_LABEL[b.platform] ?? b.platform}</div>
          <h2 className="truncate text-base font-semibold">{b.name}</h2>
        </div>
        <div className="flex items-center gap-2">
          <VerdictPill verdict={vet?.verdict ?? null} score={vet?.score} />
          {onClose ? (
            <button aria-label="Close" onClick={onClose} className="rounded p-1 text-muted-foreground hover:bg-accent">
              <IconX className="size-4" />
            </button>
          ) : null}
        </div>
      </div>

      {b.opportunity ? (
        <section>
          <h3 className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">Why this niche</h3>
          <p className="text-sm">
            <span className="font-mono font-semibold">{b.opportunity.score}</span> gap score. {b.opportunity.summary}
          </p>
        </section>
      ) : null}

      <section>
        <div className="mb-1 flex items-center justify-between">
          <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Vetting</h3>
          {vet ? <span className="text-xs text-muted-foreground">ran {timeAgo(vet.ranAt)}</span> : null}
        </div>
        {vet ? (
          <ul className="divide-y">{vet.checks.map((c) => <CheckRow key={c.id} check={c} />)}</ul>
        ) : (
          <p className="text-sm text-muted-foreground">Not vetted yet. Vetting runs the build's own tests and checks.</p>
        )}
      </section>

      <section>
        <h3 className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">Files</h3>
        <div className="flex flex-wrap gap-1">
          {b.files.map((f: string) => (
            <button
              key={f}
              onClick={() => setFile(f === file ? undefined : f)}
              className={cn("rounded border px-2 py-0.5 font-mono text-xs hover:bg-accent", f === file && "bg-accent")}
            >
              {f}
            </button>
          ))}
        </div>
        {file ? (
          <pre className="mt-2 max-h-72 overflow-auto rounded-md border bg-muted/50 p-3 font-mono text-xs leading-relaxed">
            {b.fileContent ?? "Loading…"}
          </pre>
        ) : null}
      </section>

      {b.keeper ? (
        <section>
          <h3 className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">Keeper</h3>
          <p className="text-sm text-muted-foreground">
            Last check {timeAgo(b.keeper.ranAt)}.
            {b.keeper.market ? ` Competitors: ${b.keeper.market.competitorsThen} → ${b.keeper.market.competitorsNow}. Gap score ${b.keeper.market.gapScoreThen} → ${b.keeper.market.gapScoreNow}.` : ""}
          </p>
        </section>
      ) : null}

      {b.publishResult ? (
        <section>
          <h3 className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">Dry-run publish</h3>
          <p className="text-sm">
            Packaged {b.publishResult.package.files.length} files ({b.publishResult.package.size} bytes). A live publish would run{" "}
            <code className="rounded bg-muted px-1 font-mono text-xs">{b.publishResult.wouldRun}</code>. Nothing was sent.
          </p>
        </section>
      ) : null}

      {b.decisionNote && b.status === "drafting" ? (
        <p className="rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
          Sent back: {b.decisionNote}
        </p>
      ) : null}

      <div className="flex flex-col gap-2 border-t pt-4">
        {vetM.isPending ? <WorkingBar label="Running syntax checks, tests and the secret scan" hint="a few seconds" /> : null}
        {publishM.isPending ? <WorkingBar label="Packaging the project" /> : null}
        {b.status === "drafting" ? (
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => vetM.mutate({ id })} disabled={busy}>
              <IconFlask className="size-4" />
              {vetM.isPending ? "Running checks" : vet ? "Vet again" : "Run vetting"}
            </Button>
            <Button onClick={() => askM.mutate({ id })} disabled={busy || !vet || vet.verdict === "fail"}>
              <IconSend className="size-4" />
              Request approval
            </Button>
          </div>
        ) : null}
        {b.status === "awaiting_approval" ? (
          <>
            <Textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Optional note for the agent if you send it back"
              rows={2}
              aria-label="Note for the agent"
            />
            <div className="flex gap-2">
              <Button onClick={() => decideM.mutate({ id, decision: "approve" })} disabled={busy}>
                <IconCircleCheck className="size-4" />
                Approve
              </Button>
              <Button variant="outline" onClick={() => decideM.mutate({ id, decision: "reject", note })} disabled={busy}>
                Send back
              </Button>
            </div>
          </>
        ) : null}
        {b.status === "approved" ? (
          <Button onClick={() => publishM.mutate({ id })} disabled={busy}>
            <IconPackageExport className="size-4" />
            {publishM.isPending ? "Packaging" : "Publish (dry run)"}
          </Button>
        ) : null}
        {b.status === "published_dry_run" ? (
          <p className="text-sm text-muted-foreground">Published as a dry run. Live publishing is disabled in this build.</p>
        ) : null}
      </div>
    </div>
  );
}
