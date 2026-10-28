import { defineAction, fail } from "@agent-native/core/action";
import { registerRequiredSecret } from "@agent-native/core/secrets";
import fs from "node:fs";
import path from "node:path";
import { z } from "zod";

import { requireOwner } from "../server/lib/forge.js";
import { loadPlatforms, platformsDir } from "../server/lib/platforms.js";
import { proposalFile, readProposal, validateProposal } from "../server/lib/proposals.js";

// Human-only. A manifest decides where tokens are sent, so a person must look at it before it goes live.
export default defineAction({
  description: "Approve or reject a proposed platform.",
  agentTool: false,
  mcpTool: false,
  schema: z.object({ id: z.string(), decision: z.enum(["approve", "reject"]) }),
  run: async ({ id, decision }, ctx) => {
    const owner = requireOwner(ctx);
    const p = readProposal(id) ?? fail("Proposal not found.", { statusCode: 404, errorCode: "not_found" });
    if (decision === "reject") {
      fs.rmSync(proposalFile(id), { force: true });
      return { id, status: "rejected" };
    }
    // Re-check at approval time: the world may have changed since it was proposed.
    const again = await validateProposal(p.manifest, p.templateFiles, owner);
    const m = again.manifest;
    const root = platformsDir();
    const templateRoot = path.join(root, m.template!.dir);
    fs.mkdirSync(templateRoot, { recursive: true });
    for (const [rel, text] of Object.entries(p.templateFiles)) {
      const full = path.resolve(templateRoot, rel);
      if (!full.startsWith(templateRoot + path.sep)) fail("Unsafe template path.", { statusCode: 400, errorCode: "bad_path" });
      fs.mkdirSync(path.dirname(full), { recursive: true });
      fs.writeFileSync(full, text);
    }
    fs.writeFileSync(path.join(root, `${m.id}.json`), JSON.stringify(m, null, 2) + "\n");
    fs.rmSync(proposalFile(id), { force: true });
    for (const c of m.credentials)
      registerRequiredSecret({ key: c.key, label: c.label, description: c.description, ...(c.docsUrl ? { docsUrl: c.docsUrl } : {}), scope: "user", kind: "api-key", required: false });
    return { id, status: "approved", platforms: loadPlatforms().platforms.map((x) => x.id) };
  },
});
