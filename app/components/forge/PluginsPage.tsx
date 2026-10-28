import { useActionMutation, useActionQuery } from "@agent-native/core/client/hooks";
import { useSetPageTitle } from "@agent-native/toolkit/app-shell";
import { IconCircleCheck, IconMessagePlus, IconPlug } from "@tabler/icons-react";
import { useState } from "react";
import { Link } from "react-router";
import { toast } from "sonner";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";

import { CheckRow, toastError, useRefreshActions } from "./shared";

function Proposal({ p }: { p: any }) {
  const refresh = useRefreshActions();
  const decide = useActionMutation("decide-platform-proposal", {
    onSuccess: (_r: any, v: any) => {
      refresh();
      toast.success(v.decision === "approve" ? `${p.name} added` : "Proposal rejected");
    },
    onError: (e) => toastError(e, "Could not save the decision"),
  });
  const newKeys = p.credentials.filter((c: any) => c.isNewKey);
  const tokenReports = p.reports.filter((r: any) => r.sendsToken);
  return (
    <li className="rounded-lg border border-amber-500/40 bg-amber-500/5 p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-xs text-muted-foreground">Proposed by the agent, waiting for you</div>
          <h3 className="text-sm font-semibold">{p.name}</h3>
          <p className="mt-0.5 text-sm text-muted-foreground">{p.blurb}</p>
        </div>
        <div className="flex shrink-0 gap-2">
          <Button size="sm" onClick={() => decide.mutate({ id: p.id, decision: "approve" })} disabled={decide.isPending}>
            <IconCircleCheck className="size-4" />
            Approve
          </Button>
          <Button size="sm" variant="ghost" onClick={() => decide.mutate({ id: p.id, decision: "reject" })} disabled={decide.isPending}>
            Reject
          </Button>
        </div>
      </div>

      <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm">
        <dt className="text-muted-foreground">Finds gaps with</dt>
        <dd>{p.discover.type}{p.discover.marker ? ` (marker "${p.discover.marker}")` : ""}</dd>
        <dt className="text-muted-foreground">Niches</dt>
        <dd>{p.discover.seeds.length}: {p.discover.seeds.slice(0, 6).join(", ")}{p.discover.seeds.length > 6 ? ", …" : ""}</dd>
        <dt className="text-muted-foreground">Publish</dt>
        <dd><code className="font-mono text-xs">{p.publish.command}</code> · dry run only</dd>
        <dt className="text-muted-foreground">Starter files</dt>
        <dd className="font-mono text-xs">{p.templateFiles.join(", ")}</dd>
        <dt className="text-muted-foreground">Token access</dt>
        <dd>
          {p.credentials.length === 0 ? "none" : p.credentials.map((c: any) => `${c.key} only to ${c.host ?? "(no host)"}${c.isNewKey ? " (new key)" : ""}`).join("; ")}
          {tokenReports.length ? ` · sent by ${tokenReports.length} report${tokenReports.length === 1 ? "" : "s"}` : ""}
        </dd>
      </dl>
      {newKeys.length ? <p className="mt-2 text-xs text-amber-700 dark:text-amber-300">This proposal introduces a new token key. Only approve it if you recognise the host.</p> : null}

      {p.reports.length ? (
        <details className="mt-3 text-sm">
          <summary className="cursor-pointer text-muted-foreground">Reports it would run ({p.reports.length})</summary>
          <ul className="mt-1 space-y-0.5 text-xs">
            {p.reports.map((r: any) => (
              <li key={r.id} className="break-all"><span className="font-medium">{r.title}</span> · {r.url ?? "no request"}{r.sendsToken ? " · sends a token" : ""}</li>
            ))}
          </ul>
        </details>
      ) : null}

      <details className="mt-2 text-sm" open>
        <summary className="cursor-pointer text-muted-foreground">Checked before you saw it</summary>
        <ul className="divide-y">
          {p.starterVet.checks.map((c: any) => <CheckRow key={c.label} check={c} />)}
        </ul>
        <p className="mt-2 text-xs text-muted-foreground">Live probe of the first niches:</p>
        <ul className="mt-1 space-y-0.5 text-xs">
          {p.probe.map((x: any) => <li key={x.topic}><span className="font-mono">{x.score}</span> {x.topic}: {x.summary}</li>)}
        </ul>
      </details>
    </li>
  );
}

export default function PluginsPage() {
  useSetPageTitle("Plugins");
  const refresh = useRefreshActions();
  const q = useActionQuery("list-platforms", {}) as any;
  const proposalsQ = useActionQuery("list-platform-proposals", {}) as any;
  const platforms: any[] = q.data?.platforms ?? [];
  const bad: any[] = q.data?.invalidManifests ?? [];
  const proposals: any[] = proposalsQ.data?.proposals ?? [];

  const toggle = useActionMutation("set-platform-enabled", {
    onSuccess: (r: any) => {
      refresh();
      toast.success(`${r.name} ${r.enabled ? "enabled" : "disabled"}`);
    },
    onError: (e) => toastError(e, "Could not change the platform"),
  });

  const [confirmLive, setConfirmLive] = useState<any | null>(null);
  const liveM = useActionMutation("set-platform-live", {
    onSuccess: (r: any) => {
      refresh();
      toast.success(`${r.name}: real uploading ${r.live ? "on" : "off"}`);
    },
    onError: (e) => toastError(e, "Could not change real uploading"),
  });

  return (
    <div className="h-full overflow-auto p-3 sm:p-4">
      <AlertDialog open={confirmLive !== null} onOpenChange={(o) => !o && setConfirmLive(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Upload approved builds for real?</AlertDialogTitle>
            <AlertDialogDescription>
              When you approve a build, it is uploaded to your {confirmLive?.name} account as a <b>private</b> actor and built there. It is never made public
              automatically, and you can switch this off at any time. The agent cannot change this setting.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep dry runs</AlertDialogCancel>
            <AlertDialogAction onClick={() => { liveM.mutate({ platform: confirmLive.id, live: true }); setConfirmLive(null); }}>Turn on</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <div className="mx-auto flex max-w-2xl flex-col gap-3">
        {proposals.length ? (
          <ul className="flex flex-col gap-3" aria-label="Proposed platforms">
            {proposals.map((p) => <Proposal key={p.id} p={p} />)}
          </ul>
        ) : null}

        {q.isLoading ? (
          <Skeleton className="h-40 w-full rounded-lg" />
        ) : (
          <ul className="flex flex-col gap-2">
            {platforms.map((p) => (
              <li key={p.id} className={cn("rounded-lg border p-3", !p.enabled && "opacity-60")}>
                <div className="flex items-center gap-2">
                  <IconPlug className="size-4 shrink-0" strokeWidth={1.8} />
                  <h2 className="min-w-0 flex-1 truncate text-sm font-semibold">{p.name}</h2>
                  <span className="hidden font-mono text-xs text-muted-foreground sm:inline">{p.id}.json</span>
                  <Switch
                    checked={p.enabled}
                    onCheckedChange={(on: boolean) => toggle.mutate({ platform: p.id, enabled: on })}
                    disabled={toggle.isPending}
                    aria-label={`${p.enabled ? "Disable" : "Enable"} ${p.name}`}
                  />
                </div>
                <p className="mt-1 text-sm text-muted-foreground">{p.blurb}</p>
                <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
                  <dt className="text-muted-foreground">Niches</dt>
                  <dd>{p.seeds} watched · {p.reports.length} report{p.reports.length === 1 ? "" : "s"}</dd>
                  <dt className="text-muted-foreground">Publish</dt>
                  <dd><code className="font-mono text-xs">{p.publish.command}</code> · {p.publish.live ? "live" : "dry run only"}</dd>
                  {p.credentials?.map((c: any) => (
                    <div key={c.key} className="contents">
                      <dt className="text-muted-foreground">Token</dt>
                      <dd>
                        {c.label}:{" "}
                        <span className={c.connected ? "text-emerald-600 dark:text-emerald-400" : "text-muted-foreground"}>
                          {c.connected ? "connected" : c.connected === null ? "status unavailable" : "not connected"}
                        </span>{" "}
                        <a href="/settings/api-keys" className="underline underline-offset-2">
                          {c.connected ? "Manage" : `Add ${c.key}`}
                        </a>
                      </dd>
                    </div>
                  ))}
                </dl>
                {p.liveSupported ? (
                  <div className="mt-2 flex items-center gap-3 rounded-md border bg-muted/30 p-2.5">
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-medium">Publish for real</div>
                      <p className="text-xs text-muted-foreground">
                        After you approve a build it is uploaded to your {p.name} account as a private actor and built there. Never made public automatically.
                        {p.credentials?.some((c: any) => c.connected === false) ? " Needs your token first." : ""}
                      </p>
                    </div>
                    <Switch
                      checked={p.live}
                      onCheckedChange={(on: boolean) => (on ? setConfirmLive(p) : liveM.mutate({ platform: p.id, live: false }))}
                      disabled={liveM.isPending}
                      aria-label={`${p.live ? "Turn off" : "Turn on"} real uploading for ${p.name}`}
                    />
                  </div>
                ) : null}
              </li>
            ))}
            {bad.map((b) => (
              <li key={b.file} className="rounded-lg border border-destructive/50 p-3 text-sm">
                <span className="font-mono">{b.file}</span> was not loaded: <span className="text-muted-foreground">{b.error.slice(0, 200)}</span>
              </li>
            ))}
          </ul>
        )}

        <div className="flex items-center justify-between gap-3 rounded-lg border border-dashed p-3">
          <p className="text-sm text-muted-foreground">
            Want another platform? Ask the agent, for example “add a platform for Raycast extensions”. It drafts it, checks it, and waits for your approval.
          </p>
          <Button asChild size="sm" variant="outline" className="shrink-0">
            <Link to="/chat">
              <IconMessagePlus className="size-4" />
              Ask the agent
            </Link>
          </Button>
        </div>
      </div>
    </div>
  );
}
