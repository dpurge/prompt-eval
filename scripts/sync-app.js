// Copies an application's prompts (and any extra files its registry entry
// lists) from prompt-eval into the application, or checks that they match.
//
//   node scripts/sync-app.js <app>          copy; remove managed files with no source
//   node scripts/sync-app.js <app> --check  compare only; exit 1 on any difference
//
// <app> is the name of a file in apps/. See README.md, "Applications".
const path = require("path");
const { loadApp } = require("../lib/app-registry");
const { planSync, applySync, problems } = require("../lib/app-sync");

const USAGE = "usage: node scripts/sync-app.js <app> [--check]";

// main returns the exit code: 0 ok, 1 differences found by --check, 2 bad
// usage or a broken registry entry.
function main(argv, { root, env = process.env, out = console.log, err = console.error } = {}) {
  const flags = argv.filter((a) => a.startsWith("--"));
  const names = argv.filter((a) => !a.startsWith("--"));
  const unknown = flags.filter((f) => f !== "--check");
  if (names.length !== 1 || unknown.length > 0) {
    err(unknown.length > 0 ? `unknown option ${unknown.join(", ")}\n${USAGE}` : USAGE);
    return 2;
  }
  const check = flags.includes("--check");

  let app;
  try {
    app = loadApp(names[0], { root, env });
  } catch (e) {
    err(e.message);
    return 2;
  }

  let plan;
  try {
    plan = planSync(app);
  } catch (e) {
    err(e.message);
    return 2;
  }

  if (check) {
    const found = problems(plan);
    if (found.length === 0) {
      out(`${app.name}: in sync (${plan.copies.length} files)`);
      return 0;
    }
    for (const line of found) err(line);
    err(`${app.name}: ${found.length} difference(s); run: node scripts/sync-app.js ${app.name}`);
    return 1;
  }

  const log = applySync(plan, app.promptsTarget);
  for (const line of log) out(line);
  out(`${app.name}: ${log.length === 0 ? "already in sync" : `${log.length} change(s)`} (${plan.copies.length} files managed)`);
  return 0;
}

if (require.main === module) process.exit(main(process.argv.slice(2), { root: path.join(__dirname, "..") }));

module.exports = { main };
