#!/usr/bin/env node
/**
 * Rewrite the CACHE_NAME constant in `public/service-worker.js` to a
 * content-derived hash of the rest of the file.
 *
 * Why: the SW's `activate` handler drops any cache whose name isn't
 * `CACHE_NAME`, so bumping the constant is what makes browsers pick
 * up SW changes. Historically we relied on humans remembering to
 * increment `key-stock-vN` on every edit — the audit flagged that
 * this had drifted twice in the past year, leaving PWAs stuck on
 * stale scripts. This script eliminates the human step by rehashing
 * every time `prebuild` runs (see package.json).
 *
 * How:
 *   1. Read the SW file.
 *   2. Blank out the CACHE_NAME line so its own value doesn't feed
 *      into the hash (otherwise the hash would depend on itself and
 *      never converge).
 *   3. SHA-256 the remaining content and take the first 10 hex chars.
 *   4. Write the file back with `key-stock-<hash>`. No-op when the
 *      hash already matches the current constant, so it's idempotent
 *      and won't cause spurious git churn.
 *
 * Exits with code 0 whether or not a rewrite happened; the caller
 * (npm script) doesn't distinguish those cases.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SW_PATH = resolve(__dirname, "..", "public", "service-worker.js");
// Match `const CACHE_NAME = "key-stock-anything";` — captures the
// existing suffix so we can compare before writing.
const CACHE_LINE_RE = /const CACHE_NAME = "(key-stock-[^"]+)";/;

function main() {
  let source;
  try {
    source = readFileSync(SW_PATH, "utf8");
  } catch (err) {
    console.error(`[bump-sw] failed to read ${SW_PATH}: ${err.message}`);
    process.exit(1);
  }

  const match = source.match(CACHE_LINE_RE);
  if (!match) {
    console.error(
      "[bump-sw] no CACHE_NAME line matched — did the SW file get " +
        "reformatted? Expected `const CACHE_NAME = \"key-stock-...\";`",
    );
    process.exit(1);
  }
  const currentName = match[1];

  // Compute the hash from the SW file with the CACHE_NAME line
  // blanked out — otherwise a self-referential loop where the hash
  // depends on its own value would prevent convergence.
  const stripped = source.replace(CACHE_LINE_RE, 'const CACHE_NAME = "";');
  const hash = createHash("sha256").update(stripped).digest("hex").slice(0, 10);
  const newName = `key-stock-${hash}`;

  if (currentName === newName) {
    console.log(`[bump-sw] CACHE_NAME already up to date (${currentName}).`);
    return;
  }

  const rewritten = source.replace(
    CACHE_LINE_RE,
    `const CACHE_NAME = "${newName}";`,
  );
  writeFileSync(SW_PATH, rewritten, "utf8");
  console.log(`[bump-sw] CACHE_NAME rewritten: ${currentName} → ${newName}`);
}

main();
