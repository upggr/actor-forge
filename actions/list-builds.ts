import { defineAction } from "@agent-native/core/action";
import { desc, eq } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import { parseJson, requireOwner } from "../server/lib/forge.js";

export default defineAction({
  description: "List builds with their pipeline status and latest vetting verdict.",
  schema: z.object({ limit: z.coerce.number().int().min(1).max(200).default(100) }),
  http: { method: "GET" },
  readOnly: true,
  run: async ({ limit }, ctx) => {
    const owner = requireOwner(ctx);
    const b = schema.builds;
    const rows = await getDb().select().from(b).where(eq(b.ownerEmail, owner)).orderBy(desc(b.updatedAt)).limit(limit);
    return {
      builds: rows.map((r) => {
        const vet = parseJson<{ verdict: string; score: number }>(r.vet);
        return {
          id: r.id,
          name: r.name,
          platform: r.platform,
          status: r.status,
          vetVerdict: vet?.verdict ?? null,
          vetScore: vet?.score ?? null,
          updatedAt: r.updatedAt,
        };
      }),
    };
  },
});
