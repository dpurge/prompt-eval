// Prints per-check pass rates and the failing tests of promptfoo result files:
//   node scripts/summarize.js out/a.json [out/b.json ...]
const fs = require("fs");
for (const file of process.argv.slice(2)) {
  const results = JSON.parse(fs.readFileSync(file, "utf8")).results.results;
  const checks = {};
  for (const r of results) {
    for (const [name, score] of Object.entries(r.namedScores ?? r.gradingResult?.namedScores ?? {})) {
      (checks[name] ??= []).push(score);
    }
  }
  const passed = results.filter((r) => r.success).length;
  console.log(`== ${file.split("/").pop()}: ${passed}/${results.length} tests pass`);
  for (const [name, scores] of Object.entries(checks)) {
    const ok = scores.filter((s) => s >= 0.999).length;
    console.log(`   ${name.padEnd(24)} ${ok}/${scores.length}`);
  }
  if (process.env.FAILS) {
    for (const r of results.filter((x) => !x.success).slice(0, Number(process.env.FAILS))) {
      console.log(`   FAIL ${r.description ?? r.testCase?.description ?? ""} | ${String(r.gradingResult?.reason ?? r.error ?? "").slice(0, 200)}`);
    }
  }
}
