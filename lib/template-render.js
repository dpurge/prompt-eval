// Renders a system prompt template with per-axis snippets, the way an
// application does at run time, so prompts can be evaluated exactly as the
// application will send them.
//
// An axis (see lib/app-registry.js) is a directory of snippets, one per name,
// whose chosen snippet fills a placeholder in the template; a variable named
// by the axis's `selector` says which snippet. A template may use the axes'
// placeholders and selector variables; a snippet may use only the selector
// variables. A name with no snippet renders empty. Each selected snippet is
// trimmed; after substitution, runs of three or more newlines collapse to a
// blank line and the whole text is trimmed. Inserted text is never scanned for
// placeholders again.
//
// vectors/template-render.json holds the hand-written cases that the Go
// implementation in the assistant is also tested against.
const fs = require("fs");
const path = require("path");

const PLACEHOLDER = /\{\{([^{}]*)\}\}/g;
const BLANK_RUNS = /\n{3,}/g;

function unknownPlaceholders(text, allowed) {
  const unknown = [];
  for (const [, name] of text.matchAll(PLACEHOLDER)) {
    if (!allowed.has(name)) unknown.push(`{{${name}}}`);
  }
  return [...new Set(unknown)].sort();
}

function checkPlaceholders(where, text, allowed) {
  const unknown = unknownPlaceholders(text, allowed);
  if (unknown.length > 0) throw new Error(`${where}: unknown placeholder ${unknown.join(", ")}`);
}

function substitute(text, values) {
  return text.replace(PLACEHOLDER, (_, name) => values[name] ?? "");
}

// createRenderer validates a template and its snippets once, and returns an
// object whose render(vars) produces the prompt for the selector values in
// vars (missing ones are empty).
//   axes:     [{ dir, file, placeholder, selector }]
//   snippets: { <axis.dir>: { <name>: text } }
function createRenderer({ template, templateName = "template", axes, snippets = {} }) {
  const selectors = new Set(axes.map((a) => a.selector));
  const templateAllowed = new Set([...selectors, ...axes.map((a) => a.placeholder)]);
  checkPlaceholders(templateName, template, templateAllowed);

  const trimmed = {};
  for (const axis of axes) {
    trimmed[axis.dir] = {};
    for (const [name, text] of Object.entries(snippets[axis.dir] ?? {})) {
      checkPlaceholders(`${axis.dir}/${name}/${axis.file}`, text, selectors);
      trimmed[axis.dir][name] = text.trim();
    }
  }

  return {
    render(vars = {}) {
      const values = {};
      for (const selector of selectors) values[selector] = vars[selector] ?? "";
      for (const axis of axes) {
        const chosen = Object.hasOwn(trimmed[axis.dir], values[axis.selector]) ? trimmed[axis.dir][values[axis.selector]] : "";
        values[axis.placeholder] = substitute(chosen, values);
      }
      return substitute(template, values).replace(BLANK_RUNS, "\n\n").trim();
    },
  };
}

// rendererFromApp reads an application's prompt tree (the template and the
// snippets of each axis) from disk and returns its renderer.
function rendererFromApp(app) {
  const snippets = {};
  for (const axis of app.axes) {
    snippets[axis.dir] = {};
    const dir = path.join(app.promptDir, axis.dir);
    if (!fs.existsSync(dir)) continue;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const file = path.join(dir, entry.name, axis.file);
      if (entry.isDirectory() && fs.existsSync(file)) snippets[axis.dir][entry.name] = fs.readFileSync(file, "utf8");
    }
  }
  return createRenderer({
    template: fs.readFileSync(path.join(app.promptDir, app.template), "utf8"),
    templateName: app.template,
    axes: app.axes,
    snippets,
  });
}

module.exports = { createRenderer, rendererFromApp };
