import { defineAction, fail } from "@agent-native/core/action";
import { z } from "zod";

import { requireOwner } from "../server/lib/forge.js";
import { getPlatform } from "../server/lib/platforms.js";
import { runReport } from "../server/lib/reports.js";

export default defineAction({
  description:
    "Run one report defined in a platform manifest (for example Apify runs, usage and limits) and return its numbers. Read-only; uses the stored token for that platform if the report needs one.",
  schema: z.object({
    platform: z.string().describe("Platform id from list-platforms"),
    report: z.string().describe("Report id from list-platforms, e.g. runs-30d"),
  }),
  http: { method: "GET" },
  readOnly: true,
  run: async (args, ctx) => {
    requireOwner(ctx);
    const p = getPlatform(args.platform) ?? fail("Unknown platform.", { statusCode: 404, errorCode: "unknown_platform" });
    const r = p.reports.find((x) => x.id === args.report) ?? fail("Unknown report.", { statusCode: 404, errorCode: "unknown_report" });
    return runReport(p, r);
  },
});
