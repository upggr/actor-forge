import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import { requireOwner } from "../server/lib/forge.js";
import { loadPlatforms } from "../server/lib/platforms.js";
import { listProposalIds, readProposal } from "../server/lib/proposals.js";

export default defineAction({
  description: "List platform proposals waiting for the user's approval, with what they would be allowed to do.",
  schema: z.object({}),
  http: { method: "GET" },
  readOnly: true,
  run: async (_a, ctx) => {
    requireOwner(ctx);
    const knownKeys = new Set(loadPlatforms().platforms.flatMap((p) => p.credentials.map((c) => c.key)));
    const proposals = listProposalIds().flatMap((id) => {
      const p = readProposal(id);
      if (!p) return [];
      const m = p.manifest;
      return [
        {
          id: m.id,
          name: m.name,
          blurb: m.blurb,
          createdAt: p.createdAt,
          discover: { type: m.discover.type, seeds: m.discover.seeds.map((s) => s.topic), marker: m.discover.marker ?? null },
          credentials: m.credentials.map((c) => ({ key: c.key, host: c.host ?? null, isNewKey: !knownKeys.has(c.key) })),
          reports: m.reports.map((r) => ({ id: r.id, title: r.title, type: r.type, url: r.request?.url ?? r.href ?? null, sendsToken: Boolean(r.request?.auth) })),
          publish: { command: m.publish.dryRunCommand, live: m.publish.liveEnabled },
          templateFiles: Object.keys(p.templateFiles),
          starterVet: p.starterVet,
          probe: p.probe,
          probeFailures: p.probeFailures,
        },
      ];
    });
    return { proposals };
  },
});
