import { defineAction } from "@agent-native/core/action";
import fs from "node:fs";
import { z } from "zod";

import { requireOwner } from "../server/lib/forge.js";
import { proposalFile, validateProposal } from "../server/lib/proposals.js";
import { proposalsDir } from "../server/lib/platforms.js";

export default defineAction({
  description:
    "Propose a new platform plugin. The proposal is validated for real (schema, safe paths, token hosts, the starter passes its own vetting, discovery returns data) and then WAITS for the user to approve it on the Plugins page; you cannot approve it. Call get-platform-guide first. If it returns problems, fix those and call again.",
  schema: z.object({
    manifest: z.any().describe("The platform manifest object (see get-platform-guide manifestSchema)"),
    templateFiles: z.record(z.string(), z.string()).describe("Starter files: relative path -> contents, using {{slug}} {{topic}} {{query}} {{title}}"),
  }),
  run: async ({ manifest, templateFiles }, ctx) => {
    const owner = requireOwner(ctx);
    const p = await validateProposal(manifest, templateFiles, owner);
    fs.mkdirSync(proposalsDir(), { recursive: true });
    fs.writeFileSync(proposalFile(p.manifest.id), JSON.stringify(p, null, 2));
    return {
      id: p.manifest.id,
      status: "waiting_for_approval",
      starterVet: { verdict: p.starterVet.verdict, score: p.starterVet.score },
      probe: p.probe,
      next: "Tell the user to review and approve it under Plugins.",
    };
  },
});
