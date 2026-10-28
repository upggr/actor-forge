import { fail } from "@agent-native/core/action";
import { and, eq } from "drizzle-orm";
import fs from "node:fs";
import path from "node:path";

import { getDb, schema } from "../db/index.js";
import { buildDir } from "./vet.js";
import { getPlatform, type Platform } from "./platforms.js";

export const now = () => new Date().toISOString();

export function requireOwner(ctx: { userEmail?: string | null } | undefined): string {
  return ctx?.userEmail ?? fail("Sign in first.", { statusCode: 401, errorCode: "unauthenticated" });
}

export async function getBuildOr404(id: string, owner: string) {
  const [row] = await getDb()
    .select()
    .from(schema.builds)
    .where(and(eq(schema.builds.id, id), eq(schema.builds.ownerEmail, owner)))
    .limit(1);
  if (!row) fail("Build not found.", { statusCode: 404, errorCode: "not_found" });
  return row;
}

export function platformOr404(id: string): Platform {
  return getPlatform(id) ?? fail(`Unknown platform "${id}".`, { statusCode: 404, errorCode: "unknown_platform" });
}

/** Resolve a build-relative path and refuse anything that escapes the build directory. */
export function safeBuildPath(buildId: string, rel: string): string {
  const dir = buildDir(buildId);
  const full = path.resolve(dir, rel);
  if (rel.startsWith("/") || rel.includes("\0") || (full !== dir && !full.startsWith(dir + path.sep))) {
    fail("Path must stay inside the build directory.", { statusCode: 400, errorCode: "bad_path" });
  }
  return full;
}

export function writeFiles(buildId: string, files: Record<string, string>) {
  for (const [rel, content] of Object.entries(files)) {
    const full = safeBuildPath(buildId, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content);
  }
}

export function parseJson<T>(text: string | null): T | null {
  if (!text) return null;
  try {
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}
