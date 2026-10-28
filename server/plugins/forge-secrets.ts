import { defineNitroPlugin } from "@agent-native/core/server";
import { registerRequiredSecret } from "@agent-native/core/secrets";

import { loadPlatforms } from "../lib/platforms.js";

// Each platform manifest declares the tokens it needs; they are managed in Settings, never in code.
export default defineNitroPlugin(() => {
  for (const p of loadPlatforms().platforms) {
    for (const c of p.credentials) {
      registerRequiredSecret({
        key: c.key,
        label: c.label,
        description: c.description,
        ...(c.docsUrl ? { docsUrl: c.docsUrl } : {}),
        scope: "user",
        kind: "api-key",
        required: false,
      });
    }
  }
});
