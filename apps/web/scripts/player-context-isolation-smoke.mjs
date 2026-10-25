// Contract regression guard: fast media ticks should not invalidate the
// entire library / Discovery / Imports via the common PlayerContext.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const player = readFileSync(new URL("../src/Player.tsx", import.meta.url), "utf8");
const imports = readFileSync(new URL("../src/ImportsView.tsx", import.meta.url), "utf8");
let assertions = 0;
function check(condition, message) { assert.ok(condition, message); assertions += 1; }
function section(source, start, end) {
  const from = source.indexOf(start);
  check(from !== -1, `Expected source section ${start}`);
  const stop = source.indexOf(end, from + start.length);
  check(stop > from, `Expected source section end ${end}`);
  return source.slice(from, stop);
}
const control = section(player, "type PlayerContextValue = {", "const PlayerContext =");
for (const forbidden of ["currentTime", "duration", "seekTo"]) {
  check(!new RegExp(`\\b${forbidden}\\s*:`).test(control), `Global controls must not include ${forbidden}`);
}
const controlMemo = section(player, "const contextValue = useMemo", "const progressValue =");
for (const forbidden of ["currentTime", "duration", "seekTo"]) {
  check(!new RegExp(`\\b${forbidden}\\b`).test(controlMemo), `Global memo must not subscribe to ${forbidden}`);
}
const progressMemo = section(player, "const progressValue = useMemo", "const jumpToIndex =");
for (const expected of ["currentTime", "duration", "seekTo"]) {
  check(new RegExp(`\\b${expected}\\b`).test(progressMemo), `Progress memo must include ${expected}`);
}
check(player.includes("<PlayerContext.Provider value={contextValue}>")
  && player.includes("<PlayerProgressContext.Provider value={progressValue}>")
  && /\{children\}\s*<\/PlayerProgressContext\.Provider>/.test(player),
  "App is inside the clock provider but only gets track/command notifications");
const seekWidget = section(imports, "function ImportPreviewSeek(", "function cachePreview(");
check(seekWidget.includes("usePlayerProgress()") && seekWidget.includes("Seek in preview"),
  "Active preview seek owns the audio clock subscription");
const importView = imports.slice(imports.indexOf("export function ImportsView("));
check(!/player\.(currentTime|duration|seekTo)\b/.test(importView),
  "ImportsView must not listen to rapid player ticks");
check(importView.includes("<ImportPreviewSeek"),
  "ImportsView must render focused progress widget for current preview");
console.log(`PASS: global player clock isolation (${assertions} source-contract assertions)`);