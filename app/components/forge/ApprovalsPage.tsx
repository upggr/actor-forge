import { useActionQuery } from "@agent-native/core/client/hooks";
import { useSetPageTitle } from "@agent-native/toolkit/app-shell";
import { IconCircleCheck } from "@tabler/icons-react";
import { useNavigate } from "react-router";

import { Skeleton } from "@/components/ui/skeleton";

import { BuildDetail } from "./BuildDetail";

export default function ApprovalsPage() {
  useSetPageTitle("Approvals");
  const navigate = useNavigate();
  const q = useActionQuery("list-builds", {}) as any;
  const queue: any[] = (q.data?.builds ?? []).filter((b: any) => b.status === "awaiting_approval");

  return (
    <div className="h-full overflow-auto p-4">
      {q.isLoading ? (
        <Skeleton className="mx-auto h-64 max-w-2xl rounded-lg" />
      ) : queue.length === 0 ? (
        <div className="mx-auto mt-16 max-w-sm text-center">
          <IconCircleCheck className="mx-auto size-8 text-muted-foreground" strokeWidth={1.5} />
          <p className="mt-3 text-sm font-medium">Nothing waiting for you</p>
          <p className="mt-1 text-sm text-muted-foreground">Builds appear here once they pass vetting and the agent asks for approval.</p>
        </div>
      ) : (
        <div className="mx-auto flex max-w-2xl flex-col gap-4">
          {queue.map((b) => (
            <div key={b.id} className="rounded-lg border">
              <BuildDetail id={b.id} onApprovedLive={(id) => navigate(`/pipeline?build=${id}&upload=1`)} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
