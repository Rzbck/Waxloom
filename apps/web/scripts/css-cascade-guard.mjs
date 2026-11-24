// CSS cascade guard: keep each stylesheet referenced once and stop override
// layers growing again after the initial safe file-consolidation tranche.
// Existing !important use is technical debt; do not remove it without
// visual and computed-style checks on desktop AND mobile.
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const src = join(dirname(fileURLToPath(import.meta.url)), "../src");
const sourceFiles = readdirSync(src).filter((file) => /\.(?:ts|tsx|css)$/.test(file));
const cssFiles = sourceFiles.filter((file) => file.endsWith(".css"));
const references = new Map();
let important = 0;
for (const file of sourceFiles) {
  const content = readFileSync(join(src, file), "utf8");
  if (file.endsWith(".css")) {
    important += (content.match(/!important\b/g) ?? []).length;
  }
  // All WaxLoom styles are statically imported by TSX or from another CSS.
  for (const match of content.matchAll(/(?:\bimport\s*\(?\s*["']|@import\s+(?:url\()?\s*["'])([^"']+\.css)["']/g)) {
    const target = match[1].split("/").at(-1);
    if (!references.has(target)) references.set(target, []);
    references.get(target).push(file);
  }
}
for (const file of cssFiles) {
  assert.equal(references.get(file)?.length ?? 0, 1,
    `${file}: stylesheet must be imported exactly once (no dead file or duplicate import)`);
}
for (const file of references.keys()) {
  assert.ok(cssFiles.includes(file), `${file}: imported stylesheet is missing`);
}
// Explicit normal/priority layers replace generic important patches.
assert.ok(important <= 260, "CSS !important budget exceeded: " + important);
const main = readFileSync(join(src, "main.tsx"), "utf8");
const expected = ["style-foundation.css", "style-library-controls.css", "style-responsive.css",
  "style-discovery.css", "style-mobile-player.css", "style-vinyl-library.css", "style-artwork.css", "style-console.css"];
const actual = [...main.matchAll(/import "\.\/([^"]+\.css)";/g)].map(m => m[1]);
assert.deepEqual(actual, expected, "CSS ownership and cascade order changed");
assert.equal(cssFiles.length, expected.length, "No extra override stylesheet");
assert.match(readFileSync(join(src, expected[0]), "utf8"), /@layer waxloom-base, waxloom-priority;/);
console.log("PASS CSS cascade: " + cssFiles.length + " owned stylesheets, " + important + " !important (<= 260)");
