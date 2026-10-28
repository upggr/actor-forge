import { and, eq } from "drizzle-orm";

import { getDb, schema } from "../db/index.js";

/** Platforms this user has switched off. Everything is on until someone turns it off. */
export async function disabledPlatforms(owner: string): Promise<Set<string>> {
  const rows = await getDb()
    .select({ id: schema.platformState.platformId })
    .from(schema.platformState)
    .where(and(eq(schema.platformState.ownerEmail, owner), eq(schema.platformState.enabled, "off")));
  return new Set(rows.map((r) => r.id));
}
