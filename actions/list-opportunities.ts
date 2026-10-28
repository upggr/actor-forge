import { defineAction } from "@agent-native/core/action";
import { and, desc, eq, notInArray } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import { disabledPlatforms } from "../server/lib/enabled.js";
import { parseJson, requireOwner } from "../server/lib/forge.js";

export default defineAction({
  description: "List scouted opportunities (market gaps), highest gap score first.",
  schema: z.object({
    platform: z.string().optional().describe("Platform id to filter by"),
    status: z.enum(["open", "building", "dismissed"]).optional().describe("Defaults to every status except dismissed"),
    limit: z.coerce.number().int().min(1).max(200).default(100),
  }),
  http: { method: "GET" },
  readOnly: true,
  run: async (args, ctx) => {
    const owner = requireOwner(ctx);
    const o = schema.opportunities;
    const off = [...(await disabledPlatforms(owner))];
    const rows = await getDb()
      .select()
      .from(o)
      .where(
        and(
          eq(o.ownerEmail, owner),
          args.platform ? eq(o.platform, args.platform) : undefined,
          args.status ? eq(o.status, args.status) : undefined,
          off.length && !args.platform ? notInArray(o.platform, off) : undefined,
        ),
      )
      .orderBy(desc(o.score))
      .limit(args.limit);
    return {
      opportunities: rows
        .filter((r) => args.status || r.status !== "dismissed")
        .map((r) => ({ ...r, evidence: parseJson(r.evidence) })),
    };
  },
});
