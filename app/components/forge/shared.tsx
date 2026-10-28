import { actionErrorMessage } from "@agent-native/core/client/hooks";
import { useQueryClient } from "@tanstack/react-query";
import { IconCircleCheck, IconCircleX, IconAlertTriangle } from "@tabler/icons-react";
import { toast } from "sonner";

import { cn } from "@/lib/utils";

export const PLATFORM_LABEL: Record<string, string> = { apify: "Apify", mcp: "MCP", huggingface: "Hugging Face", n8n: "n8n" };

export function useRefreshActions() {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ queryKey: ["action"] });
}

export function toastError(error: unknown, fallback: string) {
  toast.error(actionErrorMessage(error) ?? fallback);
}

export interface VetCheck {
  id: string;
  label: string;
  status: "pass" | "fail" | "warn";
  detail: string;
}

export interface VetReport {
  verdict: "pass" | "review" | "fail";
  score: number;
  checks: VetCheck[];
  ranAt: string;
}

export function CheckRow({ check }: { check: VetCheck }) {
  const Icon = check.status === "pass" ? IconCircleCheck : check.status === "warn" ? IconAlertTriangle : IconCircleX;
  return (
    <li className="flex gap-2.5 py-1.5 text-sm">
      <Icon
        className={cn(
          "mt-0.5 size-4 shrink-0",
          check.status === "pass" && "text-emerald-600 dark:text-emerald-400",
          check.status === "warn" && "text-amber-600 dark:text-amber-400",
          check.status === "fail" && "text-destructive",
        )}
        strokeWidth={1.8}
      />
      <div className="min-w-0">
        <div className="font-medium">{check.label}</div>
        <div className="break-words text-xs text-muted-foreground">{check.detail}</div>
      </div>
    </li>
  );
}

export function VerdictPill({ verdict, score }: { verdict: string | null; score?: number | null | undefined }) {
  if (!verdict) return <span className="text-xs text-muted-foreground">Not vetted</span>;
  const tone =
    verdict === "pass"
      ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300"
      : verdict === "review"
        ? "bg-amber-500/15 text-amber-700 dark:text-amber-300"
        : "bg-destructive/15 text-destructive";
  return (
    <span className={cn("rounded-full px-2 py-0.5 text-xs font-medium", tone)}>
      {verdict === "pass" ? "Passed" : verdict === "review" ? "Needs review" : "Failed"}
      {score != null ? ` · ${score}` : ""}
    </span>
  );
}

export function timeAgo(iso: string | null | undefined) {
  if (!iso) return "";
  const s = Math.max(1, Math.round((Date.now() - Date.parse(iso)) / 1000));
  if (s < 90) return `${s}s ago`;
  if (s < 5400) return `${Math.round(s / 60)}m ago`;
  if (s < 129600) return `${Math.round(s / 3600)}h ago`;
  return `${Math.round(s / 86400)}d ago`;
}

/** For waits with no measurable steps: a moving bar plus what is happening, so it never looks stuck. */
export function WorkingBar({ label, hint }: { label: string; hint?: string }) {
  return (
    <div role="status" aria-live="polite" className="w-full">
      <div className="h-1 w-full overflow-hidden rounded-full bg-muted">
        <div className="h-full w-1/3 rounded-full bg-foreground/60 motion-safe:animate-[indeterminate_1.3s_ease-in-out_infinite] motion-reduce:w-full motion-reduce:opacity-40" />
      </div>
      <div className="mt-1.5 flex items-baseline justify-between gap-3 text-xs text-muted-foreground">
        <span>{label}</span>
        {hint ? <span>{hint}</span> : null}
      </div>
    </div>
  );
}
