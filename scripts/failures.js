// Lists the failing components of promptfoo result files, one line each:
//   node scripts/failures.js out/a.json [maxLines]
const fs = require("fs");
const results = JSON.parse(fs.readFileSync(process.argv[2], "utf8")).results.results;
const max = Number(process.argv[3] ?? 60);
let n = 0;
for (const r of results.filter((x) => !x.success)) {
  const id = r.testCase?.description ?? r.description ?? "";
  const failed = (r.gradingResult?.componentResults ?? []).filter((c) => !c.pass);
  const text = failed.length ? failed.map((c) => c.reason).join(" || ") : r.gradingResult?.reason ?? r.error ?? "";
  console.log(`${id} :: ${String(text).replace(/\s+/g, " ").slice(0, 190)}`);
  if (++n >= max) break;
}
