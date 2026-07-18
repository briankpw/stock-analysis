import { defineConfig } from "vitest/config";
import path from "node:path";

/**
 * Vitest configuration.
 *
 * We keep this minimal for two reasons:
 *   1. All current tests are pure-module unit tests (no DOM / no
 *      network / no better-sqlite3), so the default `node` environment
 *      is exactly what we want — no jsdom setup cost, no eager Next
 *      transform pipeline.
 *   2. Adding config surface area today would tie future test writers
 *      to whatever we picked. Grow this file only when a specific test
 *      actually needs a browser environment or a global setup fixture.
 *
 * The only knob we DO set is the same `@/*` path alias tsconfig.json
 * declares, so tests can import from `@/lib/...` the same way
 * application code does. Without this, moving a source file that
 * imports `@/lib/utils` under `lib/` would break its tests silently.
 */
export default defineConfig({
  test: {
    environment: "node",
    include: ["lib/**/*.test.ts", "app/**/*.test.ts", "components/**/*.test.tsx"],
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "."),
    },
  },
});
