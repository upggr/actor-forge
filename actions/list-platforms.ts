import { defineAction } from "@agent-native/core/action";
import { resolveSecretDetailed } from "@agent-native/core/server";
import { z } from "zod";

import { disabledPlatforms, isLive } from "../server/lib/enabled.js";
import { requireOwner } from "../server/lib/forge.js";
import { loadPlatforms } from "../server/lib/platforms.js";

export default defineAction({
  description:
    "List the platform plugins loaded from platforms/*.json (Apify, MCP, ...). Each plugin defines how gaps are found, what is built, how it is vetted and how it is published.",
  schema: z.object({}),
  http: { method: "GET" },
  readOnly: true,
  run: async (_args, ctx) => {
    const owner = requireOwner(ctx);
    const off = await disabledPlatforms(owner);
    const { platforms, errors } = loadPlatforms();
    const liveState = new Map<string, boolean>();
    for (const p of platforms) if (p.publish.liveSupported) liveState.set(p.id, await isLive(owner, p.id));
    const status = new Map<string, boolean | null>();
    for (const c of platforms.flatMap((p) => p.credentials)) {
      const r = await resolveSecretDetailed(c.key);
      status.set(c.key, r.lookupFailed ? null : Boolean(r.value));
    }
    return {
      platforms: platforms.map((p) => ({
        enabled: !off.has(p.id),
        liveSupported: p.publish.liveSupported,
        live: p.publish.liveSupported ? liveState.get(p.id) ?? false : false,
        reports: p.reports.map((r) => ({ id: r.id, title: r.title, type: r.type, description: r.description ?? null, needsToken: Boolean(r.request?.auth), href: r.href ?? null, linkLabel: r.linkLabel ?? null })),
        credentials: p.credentials.map((c) => ({ key: c.key, label: c.label, docsUrl: c.docsUrl ?? null, connected: status.get(c.key) ?? null })),
        id: p.id,
        name: p.name,
        blurb: p.blurb,
        kind: p.kind,
        seeds: p.discover.seeds.length,
        seedTopics: p.discover.seeds.map((x) => x.topic),
        // npm-backed catalogs rate-limit hard, so they are scouted one niche at a time.
        scoutConcurrency: p.discover.type === "mcp-npm" || p.discover.type === "npm-search" ? 1 : 3,
        vet: p.vet,
        publish: { type: p.publish.type, command: p.publish.dryRunCommand, live: p.publish.liveEnabled },
        pricing: p.pricing ?? null,
      })),
      invalidManifests: errors,
    };
  },
});
