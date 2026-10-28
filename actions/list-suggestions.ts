import { defineAction } from "@agent-native/core/action";
import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import { parseJson, requireOwner } from "../server/lib/forge.js";

export default defineAction({
  description: "List price, feature and fix suggestions for the user's actors. Defaults to open ones.",
  schema: z.object({ status: z.enum(["open", "accepted", "dismissed"]).default("open") }),
  http: { method: "GET" },
  readOnly: true,
  run: async ({ status }, ctx) => {
    const owner = requireOwner(ctx);
    const S = schema.suggestions;
    const rows = await getDb().select().from(S).where(and(eq(S.ownerEmail, owner), eq(S.status, status))).orderBy(desc(S.createdAt)).limit(100);
    return { suggestions: rows.map((r) => ({ ...r, evidence: parseJson(r.evidence) })) };
  },
});
