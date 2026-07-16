#!/usr/bin/env node
/**
 * Replace `\uXXXX` and `\u{XXXXX}` escape sequences with the actual Unicode
 * characters across our source files.
 *
 * Why: JSX text content (bare text between tags) doesn't interpret backslash
 * escapes, so `<div>\u2717</div>` renders as the literal seven-character
 * string `\u2717` in the DOM. Converting to the actual `\u2717` (\u2717)
 * character makes rendering correct regardless of context (JSX text,
 * attributes, strings, comments, all fine).
 *
 * We deliberately touch only our own source directories \u2014 never
 * node_modules, .next, or generated build artifacts.
 */

import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(new URL("..", import.meta.url).pathname);
const INCLUDE_DIRS = ["app", "components", "hooks", "lib"];
const INCLUDE_FILES = []; // add explicit paths if needed
const EXTS = new Set([".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs", ".css"]);

// Regex covers `\uXXXX` (BMP) and `\u{XXXXX}` (astral, e.g. emoji surrogate pair).
const RE = /\\u\{([0-9a-fA-F]{1,6})\}|\\u([0-9a-fA-F]{4})/g;

function decode(str) {
  return str.replace(RE, (_full, braceHex, plainHex) => {
    const cp = parseInt(braceHex ?? plainHex, 16);
    return String.fromCodePoint(cp);
  });
}

/** Walk a directory tree collecting files under our allow-list of extensions. */
function walk(dir, acc = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith(".") || entry.name === "node_modules") continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, acc);
    else if (EXTS.has(path.extname(entry.name))) acc.push(full);
  }
  return acc;
}

const targets = [];
for (const d of INCLUDE_DIRS) {
  const full = path.join(ROOT, d);
  if (fs.existsSync(full)) targets.push(...walk(full));
}
for (const f of INCLUDE_FILES) targets.push(path.join(ROOT, f));

let touchedCount = 0;
let totalReplacements = 0;
for (const file of targets) {
  const original = fs.readFileSync(file, "utf8");
  RE.lastIndex = 0;
  const matches = original.match(RE);
  if (!matches) continue;
  const decoded = decode(original);
  if (decoded === original) continue;
  fs.writeFileSync(file, decoded, "utf8");
  touchedCount += 1;
  totalReplacements += matches.length;
  const rel = path.relative(ROOT, file);
  console.log(`  ${rel} (${matches.length} escape${matches.length === 1 ? "" : "s"})`);
}

console.log(`\nTouched ${touchedCount} files, replaced ${totalReplacements} escape sequences.`);
