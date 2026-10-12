const test = require("node:test");
const assert = require("node:assert/strict");
const prompts = require("../lib/prompts");
const { formatExamples, formatTranslations, flaggedFields, scoreReview } = require("../lib/review-vocabulary");
const generateTests = require("../review-vocabulary/generate-tests");

test("examples are numbered from 1 and none gives none", () => {
  assert.equal(formatExamples(["a", "b"]), "1. a\n2. b");
  assert.equal(formatExamples([]), "none");
});

test("translations list English first, notes below their locale, no trailing newline", () => {
  const text = formatTranslations([
    { locale: "pl", translation: "pies", notes: "zwierzę" },
    { locale: "en", translation: "dog" },
    { locale: "de", translation: "Hund" },
  ]);
  assert.equal(text, "- en: dog\n- de: Hund\n- pl: pies\n  notes: zwierzę");
  assert.equal(formatTranslations([]), "none");
});

test("flaggedFields reports checks that are not ok or carry a suggestion", () => {
  const reply = JSON.stringify({
    phrase: { ok: true, suggestion: "", reason: "" },
    grammar: { ok: false, suggestion: "N m", reason: "x" },
    transcription: { ok: true, suggestion: "", reason: "" },
    translations: [{ locale: "en", ok: true, suggestion: "", reason: "" }],
    notes: [{ locale: "pl", ok: false, suggestion: "", reason: "x" }],
    examples: [{ index: 1, action: "keep", suggestion: "", reason: "" }, { index: 2, action: "remove", suggestion: "", reason: "" }],
  });
  assert.deepEqual([...flaggedFields(reply).flagged].sort(), ["examples", "grammar", "notes"]);
  assert.ok(flaggedFields("nope").error);
  assert.ok(flaggedFields("{}").error);
});

test("scoreReview needs every expected flag and no unexpected main flag", () => {
  const reply = (phraseOk) => JSON.stringify({ phrase: { ok: phraseOk, suggestion: "", reason: "r" }, grammar: { ok: true }, transcription: { ok: true }, translations: [], notes: [], examples: [] });
  assert.equal(scoreReview(reply(false), { expectedFlags: '["phrase"]' }).pass, true);
  assert.equal(scoreReview(reply(true), { expectedFlags: '["phrase"]' }).pass, false);
  assert.equal(scoreReview(reply(false), { expectedFlags: "[]" }).pass, false);
  assert.equal(scoreReview(reply(true), { expectedFlags: "[]" }).pass, true);
});

test("every case renders the prompt without a placeholder left over, with its language's snippets", async () => {
  const tests = await generateTests();
  assert.ok(tests.length >= 4);
  const template = prompts.systemPrompt("review-vocabulary");
  for (const t of tests) {
    const rendered = template.replace(/\{\{(\w+)\}\}/g, (_, name) => {
      assert.ok(name in t.vars, `${t.description}: no var ${name}`);
      return t.vars[name];
    });
    assert.ok(!/\{\{\w+\}\}/.test(rendered), t.description);
    assert.ok(t.vars.dictionaryPrompt.length > 0, `${t.description}: the language has a dictionary-form snippet`);
  }
});
