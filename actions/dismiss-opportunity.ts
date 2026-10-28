import { defineAction, fail } from "@agent-native/core/action";
import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import { now, requireOwner } from "../server/lib/forge.js";

export default defineAction({
  description: "Dismiss an opportunity so it no longer appears on the radar.",
  schema: z.object({ id: z.string().describe("Opportunity id from list-opportunities") }),
  run: async ({ id }, ctx) => {
    const owner = requireOwner(ctx);
    const o = schema.opportunities;
    const res = await getDb()
      .update(o)
      .set({ status: "dismissed", updatedAt: now() })
      .where(and(eq(o.id, id), eq(o.ownerEmail, owner), eq(o.status, "open")))
      .returning({ id: o.id });
    if (!res.length) fail("Open opportunity not found.", { statusCode: 404, errorCode: "not_found" });
    return { id };
  },
});
