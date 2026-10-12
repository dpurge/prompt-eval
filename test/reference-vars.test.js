const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { referenceTests } = require("../lib/tests");
const { renderItemPrompt } = require("../lib/correction");

function withRows(rows, fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "reference-vars-"));
  try {
    fs.writeFileSync(path.join(dir, "deu-pol.yaml"), rows);
    return fn(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

const rows = `
- id: a
  phrase: Bank
  grammar: N f
  translation: ławka
  currentTranslation: ławka
  usage: Geld auf der Bank einzahlen
  sense: true
- id: b
  phrase: der Koffer
  grammar: N m
  translation: walizka
`;

// promptfoo fills {{translation}} from the test var of that name: it must be the
// phrase's existing translation, never the reference answer of the row.
test("a reference row keeps its answer out of the translation var the prompt placeholder reads", () => {
  const [withExisting, without] = withRows(rows, (dir) => referenceTests(dir)).map((t) => t.vars);
  assert.equal(withExisting.translation, "ławka");
  assert.equal(withExisting.referenceTranslation, "ławka");
  assert.equal(withExisting.sense, true);
  assert.equal(without.translation, "", "a row without an existing translation renders an empty placeholder");
  assert.equal(without.referenceTranslation, "walizka");
});

test("the correction suites fill {{translation}} from the existing translation, not the reference", () => {
  const vars = { phrase: "x", sourceLanguage: "German", targetLanguage: "Polish", translation: "REFERENCE", currentTranslation: "" };
  assert.equal(renderItemPrompt("[{{translation}}]", vars), "[]");
  assert.equal(renderItemPrompt("[{{translation}}]", { ...vars, currentTranslation: "szkoła" }), "[szkoła]");
});
