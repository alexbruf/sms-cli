import { defineWorkersConfig } from "@cloudflare/vitest-pool-workers/config";

export default defineWorkersConfig({
  test: {
    poolOptions: {
      workers: {
        wrangler: { configPath: "./wrangler.jsonc" },
        miniflare: {
          bindings: {
            PRIVATE_TOKEN: "test-private-token",
            PUBLIC_URL: "http://localhost:8787",
            WEBHOOK_SIGNING_KEY: "test-signing-key",
          },
        },
      },
    },
  },
});
