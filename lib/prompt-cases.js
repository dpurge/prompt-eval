// Turns a cases file into promptfoo tests. Nothing here knows which
// application the cases are for: the application's registry entry says how
// its system prompt is assembled, and a case only says which snippets to pick.
//
// A cases file is YAML with a top-level `cases` list (any other top-level key
// is free for anchors). A case has:
//   id           unique name
//   description  optional, shown in reports
//   select       { <selector>: <snippet name> } for the application's axes
//   input        the object sent as the user message; input.state.name names
//                the schema file, schemas/<name>.json next to the cases file
//   expect       checks, see lib/assert-reply.js
//   example      a reply that must satisfy the schema and the expectations,
//                which proves the case can be passed
const fs = require("fs");
const path = require("path");
const yaml = require("yaml");

const { loadApp } = require("./app-registry");
const { rendererFromApp } = require("./template-render");
const { assertReply } = require("./assert-reply");

function readSchema(schemasDir, stateName) {
  const file = path.join(schemasDir, `${stateName}.json`);
  if (!fs.existsSync(file)) throw new Error(`schema ${file} not found`);
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

// loadCases reads and checks a cases file. It throws on the first malformed
// case, naming it, so a typo never turns into a silent model failure.
function loadCases(casesFile, schemasDir) {
  const doc = yaml.parse(fs.readFileSync(casesFile, "utf8"));
  if (!doc || !Array.isArray(doc.cases) || doc.cases.length === 0) throw new Error(`${casesFile}: "cases" must be a non-empty list`);
  const seen = new Set();
  return doc.cases.map((c, i) => {
    const where = `${casesFile}: case ${c?.id ?? `#${i + 1}`}`;
    if (typeof c?.id !== "string" || c.id === "") throw new Error(`${where}: id is required`);
    if (seen.has(c.id)) throw new Error(`${where}: duplicate id`);
    seen.add(c.id);
    if (c.select === null || typeof c.select !== "object" || Array.isArray(c.select)) throw new Error(`${where}: select must be a mapping`);
    if (c.input === null || typeof c.input !== "object" || typeof c.input.state?.name !== "string") throw new Error(`${where}: input.state.name is required`);
    if (!Array.isArray(c.expect)) throw new Error(`${where}: expect must be a list`);
    if (typeof c.example !== "string") throw new Error(`${where}: example (a reply that passes) is required`);
    let schema;
    try {
      schema = readSchema(schemasDir, c.input.state.name);
    } catch (err) {
      throw new Error(`${where}: ${err.message}`);
    }
    return { ...c, schema };
  });
}

// checkExamples returns a message for every case whose example reply does not
// pass its own schema and expectations.
function checkExamples(cases) {
  const problems = [];
  for (const c of cases) {
    const result = assertReply(c.example, c);
    if (!result.pass) problems.push(`${c.id}: example reply fails: ${result.reason}`);
  }
  return problems;
}

// buildTests returns promptfoo tests for the cases of an application. env
// selects: SMOKE=1 keeps the first case, CASES=id,id keeps those ids.
function buildTests({ app, casesFile, schemasDir, root, env = process.env }) {
  const application = loadApp(app, { root, env });
  const renderer = rendererFromApp(application);
  let cases = loadCases(casesFile, schemasDir);
  if (env.CASES) {
    const wanted = new Set(env.CASES.split(",").map((s) => s.trim()).filter(Boolean));
    const unknown = [...wanted].filter((id) => !cases.some((c) => c.id === id));
    if (unknown.length > 0) throw new Error(`CASES names unknown case(s): ${unknown.join(", ")}`);
    cases = cases.filter((c) => wanted.has(c.id));
  }
  if (env.SMOKE) cases = cases.slice(0, 1);
  return cases.map((c) => ({
    description: c.description ? `${c.id}: ${c.description}` : c.id,
    vars: {
      system: renderer.render(c.select),
      input: JSON.stringify(c.input),
      schema: JSON.stringify(c.schema),
      expect: JSON.stringify(c.expect),
    },
  }));
}

module.exports = { loadCases, checkExamples, buildTests };
