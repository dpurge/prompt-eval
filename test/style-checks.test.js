// A starting point, not a full specification: one or two cases per rule.
const test = require("node:test");
const assert = require("node:assert/strict");
const S = require("../lib/style-checks");

const failing = (checks) => Object.entries(checks).filter(([, c]) => !c.ok).map(([name]) => name);

test("translation style: dictionary-like passes; slash, parentheses, capitals and bad separators fail", () => {
  assert.deepEqual(failing(S.translationStyle("polecać; rekomendować", { reference: "polecać" })), []);
  assert.deepEqual(failing(S.translationStyle("polecać/rekomendować", { reference: "polecać" })), ["noSlashSeparator"]);
  assert.deepEqual(failing(S.translationStyle("utrzymywać (rodzinę)", { reference: "utrzymywać" })), ["noParentheses"]);
  assert.deepEqual(failing(S.translationStyle("Pies", { reference: "pies" })), ["lowercaseUnlessName"]);
  assert.deepEqual(failing(S.translationStyle("Warszawa", { reference: "Warszawa" })), []);
  assert.deepEqual(failing(S.translationStyle("pies;kot", { reference: "pies" })), ["senseSeparator"]);
});

test("translation match: the reference's primary sense must be one of the senses", () => {
  assert.equal(S.translationMatches("koniec; zakończenie", "koniec").ok, true);
  assert.equal(S.translationMatches("zakończenie", "koniec").ok, false);
});

test("notes: none where none is needed, and never English for a Polish reader", () => {
  const polish = { targetLanguage: "Polish", referenceKnown: true };
  assert.deepEqual(failing(S.notesPolicy(null, polish)), []);
  assert.deepEqual(failing(S.notesPolicy("rzeczownik oznaczający adres", polish)), ["noNeedlessNote"]);
  assert.deepEqual(failing(S.notesPolicy("the word is used in formal writing", { ...polish, referenceNotes: "x" })), ["noteLanguage"]);
  assert.deepEqual(failing(S.notesPolicy("dosłownie „gwiazda zguby”", { ...polish, referenceNotes: "x" })), []);
});

test("transcription: Latin letters and punctuation only, diacritics and sentence capitals count", () => {
  assert.equal(S.latinTranscription("Ḏahaba ṭ-ṭālib ilā l-madrasa.").ok, true);
  assert.equal(S.latinTranscription("Nǐ hǎo， wǒ").ok, false);
  assert.equal(S.latinTranscription("kitāb كتاب").ok, false);
  assert.equal(S.strictTranscription("kitab", "kitāb").ok, false);
  assert.equal(S.strictTranscription("kitāb", "kitāb").ok, true);
  assert.equal(S.sentenceCapitals("Kuntu fī ḥāla. Lākinnanī ittaḫaḏtu.").ok, true);
  assert.equal(S.sentenceCapitals("kuntu fī ḥāla. lākinnanī").ok, false);
});

test("vocabulary: canonical POS tags and dictionary forms", () => {
  assert.equal(S.canonicalPos("N m sg").ok, true);
  assert.equal(S.canonicalPos("J").ok, false);
  assert.equal(S.dictionaryForms(["verlieren", "die Umfrage"], [["verlieren"], ["Umfrage", "die Umfrage"]]).ok, true);
  assert.equal(S.dictionaryForms(["verliert"], [["verlieren"]]).ok, false);
  assert.equal(S.dictionaryForms(["اِتَّخَذَ"], [["اتخذ"]]).ok, true);
});
