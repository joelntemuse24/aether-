import { defineConfig } from "@trigger.dev/sdk";

/**
 * Project ref comes from the operator dashboard via TRIGGER_PROJECT_ID.
 * Do not hard-code a proj_ id in this repo.
 *
 * maxDuration is compute-time seconds excluding idle suspends — not a
 * Vercel maxDuration 300 HTTP cap. Idle chats still suspend and cost nothing.
 */
export default defineConfig({
  project: process.env.TRIGGER_PROJECT_ID ?? "",
  dirs: ["./src/trigger"],
  maxDuration: 86_400,
  retries: {
    enabledInDev: false,
    default: {
      maxAttempts: 1,
      minTimeoutInMs: 1000,
      maxTimeoutInMs: 10_000,
      factor: 2,
      randomize: true,
    },
  },
  build: {
    // Aether-owned tools callback into the Next app; do not bundle Next cookies.
    external: ["next/headers"],
  },
});
