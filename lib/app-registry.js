// Reads an application's entry from apps/<name>.yaml and resolves it into
// absolute paths. prompt-eval knows nothing about any application beyond what
// these files say:
//
//   name:       the application, equal to the file name
//   promptDir:  the prompt tree in prompt-eval, relative to its root
//   target:     root    the application's directory, relative to prompt-eval's
//                       root; the env variable named by `env` overrides it
//               env     name of that environment variable
//               prompts where the prompt tree lands, relative to target.root
//   template:   the system prompt template inside promptDir
//   axes:       snippet axes; each is promptDir/<dir>/<name>/<file>, fills
//               {{placeholder}}, and is chosen by the variable `selector`
//   files:      optional extra files to copy: from (relative to prompt-eval's
//               root) to (relative to target.root)
const fs = require("fs");
const path = require("path");
const yaml = require("yaml");

const ROOT = path.join(__dirname, "..");
// Names become path segments or identifiers; refuse anything that could leave
// the directory it is meant for.
const SAFE_NAME = /^[A-Za-z][A-Za-z0-9-]*$/;
const SAFE_FILE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const IDENTIFIER = /^[A-Za-z][A-Za-z0-9]*$/;

function fail(app, message) {
  throw new Error(`apps/${app}.yaml: ${message}`);
}

// within returns the absolute path of rel under base, or throws when it would
// land outside base.
function within(base, rel, app, what) {
  if (typeof rel !== "string" || rel === "") fail(app, `${what} must be a non-empty path`);
  if (path.isAbsolute(rel)) fail(app, `${what} ${JSON.stringify(rel)} must be relative`);
  const abs = path.resolve(base, rel);
  if (abs !== base && !abs.startsWith(base + path.sep)) fail(app, `${what} ${JSON.stringify(rel)} leaves ${base}`);
  return abs;
}

function requireString(app, obj, key, where) {
  if (typeof obj?.[key] !== "string" || obj[key] === "") fail(app, `${where}${key} is required and must be a non-empty string`);
  return obj[key];
}

function loadApp(name, { root = ROOT, env = process.env } = {}) {
  if (typeof name !== "string" || !SAFE_NAME.test(name)) {
    throw new Error(`invalid application name ${JSON.stringify(name)}: expected letters, digits and "-" only`);
  }
  const file = path.join(root, "apps", `${name}.yaml`);
  if (!fs.existsSync(file)) throw new Error(`no registry entry for "${name}": expected ${file}`);
  let entry;
  try {
    entry = yaml.parse(fs.readFileSync(file, "utf8"));
  } catch (err) {
    fail(name, `not valid YAML: ${err.message}`);
  }
  if (entry === null || typeof entry !== "object" || Array.isArray(entry)) fail(name, "must be a mapping");

  if (entry.name !== name) fail(name, `name is ${JSON.stringify(entry.name)}, expected ${JSON.stringify(name)}`);
  const promptDir = within(root, requireString(name, entry, "promptDir", ""), name, "promptDir");
  if (!fs.existsSync(promptDir) || !fs.statSync(promptDir).isDirectory()) fail(name, `promptDir ${promptDir} does not exist`);

  const target = entry.target;
  if (target === null || typeof target !== "object") fail(name, "target is required");
  const envName = requireString(name, target, "env", "target.");
  if (!/^[A-Z][A-Z0-9_]*$/.test(envName)) fail(name, `target.env ${JSON.stringify(envName)} must be an upper-case variable name`);
  const configuredRoot = requireString(name, target, "root", "target.");
  const targetRoot = env[envName] ? path.resolve(env[envName]) : path.resolve(root, configuredRoot);
  const promptsTarget = within(targetRoot, requireString(name, target, "prompts", "target."), name, "target.prompts");

  const template = requireString(name, entry, "template", "");
  if (!SAFE_FILE.test(template)) fail(name, `template ${JSON.stringify(template)} is not a plain file name`);
  if (!fs.existsSync(path.join(promptDir, template))) fail(name, `template ${template} not found in ${promptDir}`);

  if (!Array.isArray(entry.axes)) fail(name, "axes must be a list (it may be empty)");
  const seen = new Set();
  const axes = entry.axes.map((axis, i) => {
    const where = `axes[${i}].`;
    const dir = requireString(name, axis, "dir", where);
    const axisFile = requireString(name, axis, "file", where);
    const placeholder = requireString(name, axis, "placeholder", where);
    const selector = requireString(name, axis, "selector", where);
    if (!SAFE_NAME.test(dir)) fail(name, `${where}dir ${JSON.stringify(dir)} is not a plain directory name`);
    if (!SAFE_FILE.test(axisFile)) fail(name, `${where}file ${JSON.stringify(axisFile)} is not a plain file name`);
    for (const [key, value] of [["placeholder", placeholder], ["selector", selector]]) {
      if (!IDENTIFIER.test(value)) fail(name, `${where}${key} ${JSON.stringify(value)} is not an identifier`);
    }
    for (const [key, value] of [["dir", dir], ["placeholder", placeholder], ["selector", selector]]) {
      const id = `${key}:${value}`;
      if (seen.has(id)) fail(name, `${where}${key} ${JSON.stringify(value)} is used by another axis`);
      seen.add(id);
    }
    return { dir, file: axisFile, placeholder, selector };
  });

  const files = (entry.files ?? []).map((item, i) => {
    const where = `files[${i}].`;
    const from = within(root, requireString(name, item, "from", where), name, `${where}from`);
    if (!fs.existsSync(from)) fail(name, `${where}from ${from} does not exist`);
    const to = within(targetRoot, requireString(name, item, "to", where), name, `${where}to`);
    return { from, to };
  });

  return { name, root, promptDir, targetRoot, promptsTarget, template, axes, files };
}

module.exports = { loadApp, SAFE_NAME };
