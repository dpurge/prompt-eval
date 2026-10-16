const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const yaml = require("yaml");
const { loadCases, checkExamples, buildTests } = require("../lib/prompt-cases");
const { assertReply } = require("../lib/assert-reply");
const { makeFixture, write } = require("./helpers/app-fixture");

const schema = { type: "object", required: ["ok"], properties: { ok: { type: "boolean" } } };

function caseFixture(cases, { schemas = { step: schema } } = {}) {
  const f = makeFixture({});
  const casesFile = path.join(f.base, "cases.yaml");
  fs.writeFileSync(casesFile, yaml.stringify({ cases }));
  const schemasDir = path.join(f.base, "schemas");
  for (const [name, s] of Object.entries(schemas)) write(path.join(schemasDir, `${name}.json`), JSON.stringify(s));
  return { f, casesFile, schemasDir };
}

const good = {
  id: "one",
  description: "a case",
  select: { language: "xaa", output: "quiz" },
  input: { state: { name: "step" }, run_state: {} },
  expect: [{ path: "ok", equals: true }],
  example: '{"ok":true}',
};

test("a well-formed cases file loads with its schema attached", () => {
  const { f, casesFile, schemasDir } = caseFixture([good]);
  try {
    const cases = loadCases(casesFile, schemasDir);
    assert.equal(cases.length, 1);
    assert.deepEqual(cases[0].schema, schema);
  } finally {
    f.cleanup();
  }
});

test("each kind of malformed case is refused, naming the case", () => {
  const bad = [
    [{ ...good, id: "" }, /id is required/],
    [{ ...good, select: undefined }, /select must be a mapping/],
    [{ ...good, select: ["xaa"] }, /select must be a mapping/],
    [{ ...good, input: { state: {} } }, /input\.state\.name is required/],
    [{ ...good, input: "text" }, /input\.state\.name is required/],
    [{ ...good, expect: undefined }, /expect must be a list/],
    [{ ...good, example: undefined }, /example .* is required/],
    [{ ...good, input: { state: { name: "ghost" } } }, /schema .*ghost\.json not found/],
  ];
  for (const [c, pattern] of bad) {
    const { f, casesFile, schemasDir } = caseFixture([c]);
    try {
      assert.throws(() => loadCases(casesFile, schemasDir), pattern, JSON.stringify(c));
    } finally {
      f.cleanup();
    }
  }
});

test("duplicate ids and empty files are refused", () => {
  const { f, casesFile, schemasDir } = caseFixture([good, good]);
  try {
    assert.throws(() => loadCases(casesFile, schemasDir), /duplicate id/);
    fs.writeFileSync(casesFile, "cases: []\n");
    assert.throws(() => loadCases(casesFile, schemasDir), /non-empty list/);
    fs.writeFileSync(casesFile, "other: 1\n");
    assert.throws(() => loadCases(casesFile, schemasDir), /non-empty list/);
  } finally {
    f.cleanup();
  }
});

test("YAML anchors may be used to share blocks between cases", () => {
  const { f, casesFile, schemasDir } = caseFixture([good]);
  try {
    fs.writeFileSync(casesFile, `shared: &s { name: step }
cases:
  - { id: a, select: {}, input: { state: *s }, expect: [], example: '{"ok":true}' }
  - { id: b, select: {}, input: { state: *s }, expect: [], example: '{"ok":true}' }
`);
    assert.deepEqual(loadCases(casesFile, schemasDir).map((c) => c.id), ["a", "b"]);
  } finally {
    f.cleanup();
  }
});

test("checkExamples reports a case whose example cannot pass", () => {
  const { f, casesFile, schemasDir } = caseFixture([good, { ...good, id: "broken", example: '{"ok":"yes"}' }, { ...good, id: "strict", example: '{"ok":false}' }]);
  try {
    const problems = checkExamples(loadCases(casesFile, schemasDir));
    assert.equal(problems.length, 2);
    assert.match(problems[0], /^broken: example reply fails: reply breaks the schema/);
    assert.match(problems[1], /^strict: example reply fails: expected ok to equal true/);
  } finally {
    f.cleanup();
  }
});

test("buildTests renders the system prompt per case and carries the case as vars", () => {
  const { f, casesFile, schemasDir } = caseFixture([good, { ...good, id: "two", select: { language: "xbb" } }]);
  try {
    const tests = buildTests({ app: "demo", casesFile, schemasDir, root: f.root, env: {} });
    assert.equal(tests.length, 2);
    assert.equal(tests[0].description, "one: a case");
    assert.equal(tests[1].description, "two: a case");
    assert.equal(tests[0].vars.system, "Base Rules A Quiz");
    assert.equal(tests[1].vars.system, "Base Rules B");
    assert.deepEqual(JSON.parse(tests[0].vars.input), good.input);
    assert.deepEqual(JSON.parse(tests[0].vars.schema), schema);
    assert.deepEqual(JSON.parse(tests[0].vars.expect), good.expect);
  } finally {
    f.cleanup();
  }
});

test("SMOKE keeps one case and CASES selects by id", () => {
  const { f, casesFile, schemasDir } = caseFixture([good, { ...good, id: "two" }, { ...good, id: "three" }]);
  try {
    const run = (env) => buildTests({ app: "demo", casesFile, schemasDir, root: f.root, env }).map((t) => t.description.split(":")[0]);
    assert.deepEqual(run({ SMOKE: "1" }), ["one"]);
    assert.deepEqual(run({ CASES: "three, one" }), ["one", "three"]);
    assert.throws(() => run({ CASES: "nope" }), /unknown case\(s\): nope/);
  } finally {
    f.cleanup();
  }
});

test("a reply to a built test is scored by the glue from the same vars", () => {
  const { f, casesFile, schemasDir } = caseFixture([good]);
  try {
    const [t] = buildTests({ app: "demo", casesFile, schemasDir, root: f.root, env: {} });
    const result = assertReply('{"ok":true}', { schema: JSON.parse(t.vars.schema), expect: JSON.parse(t.vars.expect) });
    assert.equal(result.pass, true);
  } finally {
    f.cleanup();
  }
});

// ── the assistant-step suite itself ────────────────────────────────────────

const suiteDir = path.join(__dirname, "..", "assistant-step");

test("assistant-step: every case loads and its example reply passes", () => {
  const cases = loadCases(path.join(suiteDir, "cases.yaml"), path.join(suiteDir, "schemas"));
  assert.ok(cases.length >= 8, `${cases.length} cases`);
  assert.deepEqual(checkExamples(cases), []);
});

test("assistant-step: the required situations are covered", () => {
  const ids = loadCases(path.join(suiteDir, "cases.yaml"), path.join(suiteDir, "schemas")).map((c) => c.id);
  for (const wanted of [
    /^intake-empty/, /^intake-remembered/, /correct-answer/, /wrong-answer/, /last-answer/, /lesson-fetched/, /tool-error/, /refused/,
  ]) {
    assert.ok(ids.some((id) => wanted.test(id)), `no case matching ${wanted}`);
  }
});

test("assistant-step: a reply that breaks the schema fails every case", () => {
  const cases = loadCases(path.join(suiteDir, "cases.yaml"), path.join(suiteDir, "schemas"));
  const wrong = '{"state_patch":{},"action":{"type":"goto","state":"nowhere"}}';
  for (const c of cases) assert.equal(assertReply(wrong, c).pass, false, c.id);
});

test("assistant-step: the cases render the prompt with the snippets they select", () => {
  const tests = buildTests({
    app: "assistant",
    casesFile: path.join(suiteDir, "cases.yaml"),
    schemasDir: path.join(suiteDir, "schemas"),
    env: {},
  });
  for (const t of tests) {
    assert.doesNotMatch(t.vars.system, /\{\{/, t.description);
    assert.match(t.vars.system, /Modern Standard Arabic/, t.description);
  }
  const byId = (prefix) => tests.find((t) => t.description.startsWith(prefix));
  assert.match(byId("assess-correct-answer").vars.system, /"kind": "quiz"/);
  assert.doesNotMatch(byId("assess-correct-answer").vars.system, /"kind": "lesson"/);
  assert.match(byId("teach-lesson-fetched").vars.system, /"kind": "lesson"/);
  assert.doesNotMatch(byId("intake-empty").vars.system, /"kind": "(quiz|lesson)"/);
});

test("assistant-step: the promptfoo config has the shape the suite relies on", () => {
  const config = yaml.parse(fs.readFileSync(path.join(suiteDir, "promptfooconfig.yaml"), "utf8"));
  const files = [...config.prompts, config.defaultTest.assert[0].value, config.tests].map((ref) => path.resolve(suiteDir, ref.replace(/^file:\/\//, "")));
  for (const file of files) assert.ok(fs.existsSync(file), `${file} must exist`);
  const provider = config.providers[0];
  assert.equal(provider.config.think, false);
  assert.ok(provider.config.num_ctx >= 8192);
  assert.equal("format" in provider.config, false, "format is per provider in promptfoo, so it is left out");
  assert.equal(config.defaultTest.assert[0].type, "javascript");
});

test("assistant-step: the test generator is a function that yields tests", async () => {
  const generate = require("../assistant-step/generate-tests");
  const tests = await generate();
  assert.ok(tests.length >= 8);
  for (const t of tests) assert.ok(t.vars.system && t.vars.input && t.vars.schema && t.vars.expect, t.description);
});

test("assistant-step: assess-last-answer accepts concluding or asking another recorded question, not a lost one", () => {
  const c = loadCases(path.join(suiteDir, "cases.yaml"), path.join(suiteDir, "schemas")).find((x) => x.id === "assess-last-answer");
  const ask = (patch) => JSON.stringify({ state_patch: patch, action: { type: "ask_user", payload: { kind: "quiz", number: 6, question: "Q6?" } } });
  const asked = ask({ assessment: { asked: 6, correct: 4 }, pending: { question: "Q6?", expected: "x" } });
  assert.equal(assertReply(asked, c).pass, true, assertReply(asked, c).reason);
  const lost = ask({ assessment: { asked: 6, correct: 4 } });
  assert.equal(assertReply(lost, c).pass, false, "a question that is not recorded in pending cannot be judged later");
  const miscounted = ask({ assessment: { asked: 6, correct: 3 }, pending: { question: "Q6?", expected: "x" } });
  assert.equal(assertReply(miscounted, c).pass, false);
  assert.equal(assertReply(c.example, c).pass, true);
});
