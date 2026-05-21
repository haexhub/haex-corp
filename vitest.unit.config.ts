import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";
import vue from "@vitejs/plugin-vue";

/**
 * Vitest config for browser-side unit tests (Pinia stores, composables,
 * pure-TS helpers in `app/`). Runs in happy-dom so `window.localStorage`
 * + DOM globals exist without booting a real browser.
 *
 * Why this is separate from `vitest.config.ts`: that one boots a full
 * Nuxt+Nitro server via @nuxt/test-utils for API e2e and is heavy. Unit
 * tests need none of that and should run in <1s per file.
 *
 * @vitejs/plugin-vue is included so component-shape tests can import
 * `.vue` files directly without booting Nuxt.
 */
export default defineConfig({
  plugins: [vue()],
  test: {
    include: ["tests/unit/**/*.test.ts"],
    environment: "happy-dom",
    globals: false,
    testTimeout: 5_000,
  },
  resolve: {
    alias: {
      "~": fileURLToPath(new URL("./app", import.meta.url)),
      "@": fileURLToPath(new URL("./app", import.meta.url)),
      // Nuxt 4 exposes top-level `shared/` as #shared at build time;
      // unit tests need the same alias since they don't boot Nuxt.
      "#shared": fileURLToPath(new URL("./shared", import.meta.url)),
    },
  },
});
