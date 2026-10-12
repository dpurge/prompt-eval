const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const yaml = require("yaml");
const { formatCandidates, renderCheckPrompt, parseVerdicts, scoreCheck } = require("../lib/check-vocabulary");

const root = path.join(__dirname, "..");

// The same input and output as TestFormatCheckItemsNumbersFromOneAndSpellsOutWhatIsMissing
// in phraseforge/internal/ai/check_test.go: the two renderings must stay equal.
test("formatCandidates lays candidates out as phraseforge does", () => {
  const got = formatCandidates([
    { phrase: "der Koffer", usage: "den Koffer packen", examples: ["ein schwerer Koffer", "der alte Koffer"], translations: { pl: "walizka", en: "suitcase; case" } },
    { phrase: "der Tag", usage: "jeden Tag" },
  ]);
  assert.equal(
    got,
    "1. der Koffer\n   usage: den Koffer packen\n   examples: ein schwerer Koffer | der alte Koffer\n   translations: en: suitcase; case | pl: walizka\n" +
      "2. der Tag\n   usage: jeden Tag\n   examples: none\n   translations: none\n",
  );
});

test("renderCheckPrompt fills both placeholders in one pass", () => {
  assert.equal(renderCheckPrompt("{{sourceLanguage}}:\n{{candidates}}\n{{unknown}}", { sourceLanguage: "German", candidates: "1. {{sourceLanguage}}" }), "German:\n1. {{sourceLanguage}}\n{{unknown}}");
});

test("the default check prompt uses both placeholders", () => {
  const prompt = fs.readFileSync(path.join(root, "prompt", "phraseforge", "default", "system", "check-vocabulary.txt"), "utf8");
  assert.match(prompt, /\{\{sourceLanguage\}\}/);
  assert.match(prompt, /\{\{candidates\}\}/);
});

test("parseVerdicts reads both verdicts of the marked candidates and ignores bad entries", () => {
  const reply = JSON.stringify({ results: [
    { n: 1, needsExample: true, needsSense: false },
    { n: 2, needsExample: false, needsSense: true },
    { n: 3, needsExample: true, needsSense: true },
    { n: 4, needsExample: true },
    "x", { n: 2 }, { n: "1", needsExample: true }, { needsExample: true },
  ] });
  assert.deepEqual([...parseVerdicts(reply, 3).verdicts], [
    [0, { needsExample: true, needsSense: false }],
    [1, { needsExample: false, needsSense: true }],
    [2, { needsExample: true, needsSense: true }],
  ]);
  assert.deepEqual([...parseVerdicts('{"results":[]}', 3).verdicts], []);
  // an absent or non-boolean needsSense counts as false; needsExample must be a boolean
  assert.deepEqual([...parseVerdicts('{"results":[{"n":1,"needsExample":true},{"n":2,"needsExample":true,"needsSense":"yes"},{"n":3,"needsSense":true}]}', 3).verdicts], [
    [0, { needsExample: true, needsSense: false }],
    [1, { needsExample: true, needsSense: false }],
  ]);
});

test("parseVerdicts rejects a reply that is not an object with a results array", () => {
  for (const reply of ["yes", "[]", '{"answer":[]}', '{"results":"none"}', '{"results":null}']) {
    assert.ok(parseVerdicts(reply, 3).error, reply);
  }
});

test("scoreCheck passes only when every verdict, both kinds, is right and says which one is wrong", () => {
  const vars = { expected: JSON.stringify([{ example: true, sense: false }, { example: false, sense: false }, { example: true, sense: true }]) };
  const right = '{"results":[{"n":1,"needsExample":true,"needsSense":false},{"n":2,"needsExample":false,"needsSense":false},{"n":3,"needsExample":true,"needsSense":true}]}';
  assert.equal(scoreCheck(right, vars).pass, true);
  const noSense = scoreCheck('{"results":[{"n":1,"needsExample":true,"needsSense":false},{"n":3,"needsExample":true,"needsSense":false}]}', vars);
  assert.equal(noSense.pass, false);
  assert.ok(Math.abs(noSense.score - 2 / 3) < 1e-9);
  assert.match(noSense.reason, /candidate 3: needsSense false, expected true/);
  const missing = scoreCheck('{"results":[{"n":1,"needsExample":true,"needsSense":false}]}', vars);
  assert.match(missing.reason, /candidate 3: needsExample false, expected true/);
  assert.deepEqual(scoreCheck("nonsense", vars), { pass: false, score: 0, reason: parseVerdicts("nonsense", 3).error });
});

test("the cases file is well formed: a usage and a boolean verdict for every candidate, both kinds of verdict present", () => {
  const cases = yaml.parse(fs.readFileSync(path.join(root, "check-vocabulary", "data", "cases.yaml"), "utf8"));
  const verdicts = new Set();
  for (const c of cases) {
    assert.ok(c.id && c.language && c.items.length > 0, c.id);
    for (const item of c.items) {
      assert.ok(item.phrase && item.usage, `${c.id}: ${item.phrase}`);
      assert.equal(typeof item.expected, "boolean", `${c.id}: ${item.phrase}`);
      verdicts.add(item.expected);
    }
  }
  assert.equal(verdicts.size, 2);
});

test("the suite builds one test per case, selectable by language", async () => {
  const build = require("../check-vocabulary/generate-tests");
  const saved = { SMOKE: process.env.SMOKE, LANGS: process.env.LANGS };
  try {
    delete process.env.SMOKE;
    delete process.env.LANGS;
    const all = await build();
    assert.equal(all.length, 2);
    assert.deepEqual(JSON.parse(all[0].vars.expected), [
      { example: true, sense: false }, { example: false, sense: false }, { example: true, sense: false }, { example: false, sense: false }, { example: true, sense: true },
    ]);
    process.env.LANGS = "arb";
    assert.deepEqual((await build()).map((t) => t.description), ["arb-001"]);
    delete process.env.LANGS;
    process.env.SMOKE = "1";
    assert.equal((await build()).length, 1);
  } finally {
    for (const [key, value] of Object.entries(saved)) value === undefined ? delete process.env[key] : (process.env[key] = value);
  }
});
