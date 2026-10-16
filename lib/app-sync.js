// Plans and applies the copy of an application's prompt tree and extra files
// into the application. Only files the registry entry manages are ever
// written, compared or removed: the template, each axis's <dir>/<name>/<file>
// and the extra files. Anything else in either tree is left alone.
const fs = require("fs");
const path = require("path");
const { SAFE_NAME } = require("./app-registry");

// filesUnder lists every file below dir as sorted paths relative to it.
function filesUnder(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true })
    .flatMap((entry) => (entry.isDirectory()
      ? filesUnder(path.join(dir, entry.name)).map((f) => path.join(entry.name, f))
      : [entry.name]))
    .sort();
}

// managedPromptFiles returns the relative paths, under a prompt tree, that the
// entry manages: the template and every <axis.dir>/<name>/<axis.file>.
function managedPromptFiles(app, treeDir) {
  const managed = [app.template];
  for (const axis of app.axes) {
    const axisDir = path.join(treeDir, axis.dir);
    if (!fs.existsSync(axisDir)) continue;
    for (const entry of fs.readdirSync(axisDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      if (!SAFE_NAME.test(entry.name)) {
        throw new Error(`${path.join(axisDir, entry.name)}: name must be letters, digits and "-" only`);
      }
      if (fs.existsSync(path.join(axisDir, entry.name, axis.file))) {
        managed.push(path.join(axis.dir, entry.name, axis.file));
      }
    }
  }
  return managed.sort();
}

function same(a, b) {
  return fs.existsSync(b) && fs.readFileSync(a).equals(fs.readFileSync(b));
}

// planSync compares the source with the target. Each copy says whether its
// destination is missing, differs (byte for byte) or is the same; stale lists
// managed files in the target whose source no longer exists.
function planSync(app) {
  const copies = [];
  const sources = managedPromptFiles(app, app.promptDir);
  for (const rel of sources) {
    copies.push({ src: path.join(app.promptDir, rel), dst: path.join(app.promptsTarget, rel) });
  }
  for (const file of app.files) copies.push({ src: file.from, dst: file.to });
  for (const copy of copies) {
    copy.status = !fs.existsSync(copy.dst) ? "missing" : same(copy.src, copy.dst) ? "same" : "differs";
  }
  const stale = managedPromptFiles(app, app.promptsTarget)
    .filter((rel) => !sources.includes(rel))
    .map((rel) => path.join(app.promptsTarget, rel));
  return { copies, stale };
}

function problems(plan) {
  const out = [];
  for (const c of plan.copies) {
    if (c.status === "missing") out.push(`${c.dst} is missing (source ${c.src})`);
    if (c.status === "differs") out.push(`${c.dst} differs from ${c.src} (byte for byte)`);
  }
  for (const s of plan.stale) out.push(`${s} has no source any more`);
  return out;
}

// applySync writes the missing and different files and removes stale ones,
// pruning directories that become empty. It returns a log of what it did.
function applySync(plan, stopDir) {
  const log = [];
  for (const c of plan.copies) {
    if (c.status === "same") continue;
    fs.mkdirSync(path.dirname(c.dst), { recursive: true });
    fs.copyFileSync(c.src, c.dst);
    log.push(`${c.status === "missing" ? "created" : "updated"} ${c.dst}`);
  }
  for (const s of plan.stale) {
    fs.rmSync(s);
    log.push(`removed ${s}`);
    for (let dir = path.dirname(s); dir !== stopDir && dir.startsWith(stopDir + path.sep); dir = path.dirname(dir)) {
      if (fs.readdirSync(dir).length > 0) break;
      fs.rmdirSync(dir);
    }
  }
  return log;
}

module.exports = { planSync, applySync, problems, managedPromptFiles, filesUnder };
