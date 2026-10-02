const test = require("node:test");
const assert = require("node:assert/strict");
const { renderItemPrompt, goQuote, errors, correctionMessage, variants, conversation, CORRECTION_TEMPLATE } = require("../lib/correction");

// The expected strings below were produced by phraseforge's own
// parseVocabularyItemResponse / parseModelsItemResponse (Go).
test("error strings equal the ones phraseforge produces", () => {
  assert.equal(errors.invalidJson("vocabulary", "invalid character '`' looking for beginning of value"),
    "vocabulary item response: invalid JSON: invalid character '`' looking for beginning of value");
  assert.equal(errors.missing("vocabulary", "translation"), 'vocabulary item response: missing "translation"');
  assert.equal(errors.missing("models", "phrase"), 'models item response: missing "phrase"');
  assert.equal(errors.wrongType("vocabulary", "grammar", "array"), 'vocabulary item response: "grammar" must be a string or null, got array');
  assert.equal(errors.wrongType("models", "transcription", "object"), 'models item response: "transcription" must be a string or null, got object');
  assert.equal(errors.mismatch("vocabulary", "¿Como estás?", "¿Cómo estás?"),
    `vocabulary item response: phrase "¿Como estás?" does not match the item's phrase "¿Cómo estás?"`);
  assert.equal(errors.mismatch("models", "Es gibt ...", "Es gibt …"),
    `models item response: phrase "Es gibt ..." does not match the item's phrase "Es gibt …"`);
});

test("Go %q quoting escapes quotes and backslashes in the stored phrase", () => {
  assert.equal(errors.mismatch("vocabulary", "Eingang/Ausgang", "Eingang\\Ausgang"),
    `vocabulary item response: phrase "Eingang/Ausgang" does not match the item's phrase "Eingang\\\\Ausgang"`);
  assert.equal(errors.mismatch("vocabulary", "Er sagte: Ich komme.", 'Er sagte: "Ich komme."'),
    `vocabulary item response: phrase "Er sagte: Ich komme." does not match the item's phrase "Er sagte: \\"Ich komme.\\""`);
  assert.equal(goQuote("a\nb"), '"a\\nb"');
});

test("the correction turn is the template with the error spliced in verbatim", () => {
  assert.equal(correctionMessage("boom"), "Your previous reply was rejected: boom\nReturn only the corrected JSON object.");
  // a "$&" in an error (a phrase can contain anything) must not be expanded
  assert.ok(correctionMessage('phrase "$&"').includes('phrase "$&"'));
  assert.ok(CORRECTION_TEMPLATE.includes("{{error}}"));
});

test("renderItemPrompt substitutes in one pass", () => {
  const out = renderItemPrompt("{{phrase}} / {{grammarPrompt}} / {{unknown}}", { phrase: "{{grammarPrompt}}", grammarPrompt: "G" });
  assert.equal(out, "{{grammarPrompt}} / G / {{unknown}}");
});

const base = { phrase: "der Koffer", translation: "walizka", grammar: "N m", sourceLanguage: "German", targetLanguage: "Polish", grammarPrompt: "G", transcriptionPrompt: "" };

test("every vocabulary variant is a genuinely bad reply", () => {
  const { validateReply } = require("../lib/validate-reply");
  const all = variants("vocabulary", base);
  assert.ok(all.length >= 8);
  for (const v of all) {
    if (v.failure === "wrong-type") {
      const parsed = JSON.parse(v.raw);
      assert.ok(Object.values(parsed).some((x) => typeof x === "object" && x !== null), `${v.id} has no non-string field`);
      continue;
    }
    const result = validateReply(v.raw, { ...base, structureOnly: true });
    assert.equal(result.pass, false, `${v.id} should be rejected, got: ${result.reason}`);
  }
});

test("variants that would not change the phrase are skipped", () => {
  const ids = variants("vocabulary", { ...base, phrase: "名字", translation: "imię", grammar: "N" }).map((v) => v.id);
  assert.ok(!ids.includes("drop-first-word"), "one-word phrase has no word to drop");
  assert.ok(!ids.includes("toggle-first-case"), "CJK has no case");
  assert.ok(!ids.includes("strip-punctuation"), "no punctuation to strip");
  assert.ok(!ids.includes("drop-accents"), "no accents to drop");
  assert.ok(ids.includes("translated-phrase"));
});

test("models variants use the models error wording and a non-string transcription", () => {
  const all = variants("models", { phrase: "Ich möchte ... bestellen", sourceLanguage: "German", targetLanguage: "Polish" });
  assert.ok(all.every((v) => v.error.startsWith("models item response: ")));
  assert.ok(all.some((v) => v.id === "transcription-object"));
  assert.ok(!all.some((v) => v.id === "translated-phrase"), "no reference translation for pattern rows");
});

test("conversation is original prompt, rejected reply, correction", () => {
  const [v] = variants("vocabulary", base).filter((x) => x.id === "code-fence");
  const messages = conversation("Translate {{phrase}} to {{targetLanguage}}", base, v);
  assert.deepEqual(messages.map((m) => m.role), ["user", "assistant", "user"]);
  assert.equal(messages[0].content, "Translate der Koffer to Polish");
  assert.equal(messages[1].content, v.raw);
  assert.equal(messages[2].content, correctionMessage(v.error));
});
