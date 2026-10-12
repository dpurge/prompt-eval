const test = require("node:test");
const assert = require("node:assert/strict");
const { validateReply } = require("../lib/validate-reply");

const reply = (obj) => JSON.stringify(obj);
const deu = { phrase: "der Koffer", translation: "walizka", grammar: "N m", grammarPrompt: "Grammar tags…", transcriptionPrompt: "" };
const cmn = { phrase: "名字", translation: "imię", grammar: "N", transcription: "míngzi", grammarPrompt: "Grammar tags…", transcriptionPrompt: "Transcribe using pinyin." };

test("a correct reply passes with full score", () => {
  const r = validateReply(reply({ phrase: "der Koffer", grammar: "N m", translation: "walizka" }), deu);
  assert.equal(r.pass, true);
  assert.equal(r.score, 1);
});

test("a code fence is not plain JSON, as in phraseforge", () => {
  const r = validateReply("```json\n" + reply({ phrase: "der Koffer", translation: "walizka" }) + "\n```", deu);
  assert.equal(r.pass, false);
  assert.match(r.reason, /not valid JSON/);
});

test("non-object JSON is rejected", () => {
  for (const raw of ["[]", "null", '"text"', "42"]) assert.equal(validateReply(raw, deu).pass, false, raw);
});

test("missing or blank phrase / translation fail", () => {
  assert.match(validateReply(reply({ translation: "walizka" }), deu).reason, /Missing "phrase"/);
  assert.match(validateReply(reply({ phrase: "der Koffer", translation: "  " }), deu).reason, /Missing "translation"/);
});

test("a changed phrase fails, naming both phrases", () => {
  const r = validateReply(reply({ phrase: "Koffer", translation: "walizka" }), deu);
  assert.equal(r.pass, false);
  assert.match(r.reason, /"Koffer" does not match the item's phrase "der Koffer"/);
});

test("phrase compares after trim and NFC", () => {
  const nfd = "das Mädchen";
  const nfc = "das Mädchen";
  assert.equal(validateReply(reply({ phrase: nfc, translation: "dziewczynka" }), { phrase: nfd, structureOnly: true }).pass, true);
  assert.equal(validateReply(reply({ phrase: `  ${nfd}  `, translation: "dziewczynka" }), { phrase: nfc, structureOnly: true }).pass, true);
});

test("a wrong translation fails; accents are forgiven, but a capitalized word or a final full stop is not (dictionary style)", () => {
  assert.equal(validateReply(reply({ phrase: "der Koffer", grammar: "N m", translation: "kufer" }), deu).pass, false);
  assert.equal(validateReply(reply({ phrase: "der Koffer", grammar: "N m", translation: "walizka" }), deu).pass, true);
  assert.equal(validateReply(reply({ phrase: "der Koffer", grammar: "N m", translation: "Walizka" }), deu).pass, false);
  assert.equal(validateReply(reply({ phrase: "der Koffer", grammar: "N m", translation: "walizka." }), deu).pass, false);
});

test("grammar counts only when the language has a grammar section", () => {
  const noSection = { ...deu, grammarPrompt: "" };
  assert.equal(validateReply(reply({ phrase: "der Koffer", grammar: "wrong", translation: "walizka" }), noSection).pass, true);
  assert.equal(validateReply(reply({ phrase: "der Koffer", grammar: "wrong", translation: "walizka" }), deu).pass, false);
});

test("transcription is scored by similarity >= 0.9 only with a section", () => {
  const good = validateReply(reply({ phrase: "名字", grammar: "N", transcription: "míngzi", translation: "imię" }), cmn);
  assert.equal(good.pass, true);
  // dropping the tone marks is no longer good enough: diacritics count
  const noTones = validateReply(reply({ phrase: "名字", grammar: "N", transcription: "mingzi", translation: "imię" }), cmn);
  assert.equal(noTones.pass, false);
  assert.match(noTones.reason, /transcriptionStrict/);
  const bad = validateReply(reply({ phrase: "名字", grammar: "N", transcription: "xyz", translation: "imię" }), cmn);
  assert.equal(bad.pass, false);
  const noSection = { ...cmn, transcriptionPrompt: "" };
  assert.equal(validateReply(reply({ phrase: "名字", grammar: "N", transcription: "xyz", translation: "imię" }), noSection).pass, true);
});

test("structureOnly checks JSON, non-blank fields and the phrase echo — no reference scoring", () => {
  const vars = { phrase: 'Er sagte: "Ich komme."', structureOnly: true };
  assert.equal(validateReply(reply({ phrase: 'Er sagte: "Ich komme."', translation: "anything" }), vars).pass, true);
  assert.equal(validateReply(reply({ phrase: "Er sagte: Ich komme.", translation: "anything" }), vars).pass, false);
  assert.equal(validateReply("not json", vars).pass, false);
});

test("failures carry a named score so a report can group them", () => {
  assert.deepEqual(validateReply("nope", deu).namedScores, { json: 0 });
  assert.deepEqual(validateReply(reply({ phrase: "x", translation: "y" }), deu).namedScores, { phrase: 0 });
});

test("an optional example is scored on style only: short and not a known one", () => {
  const withExamples = { ...deu, examples: "- einen Koffer packen\n- der große Koffer" };
  const good = validateReply(reply({ phrase: "der Koffer", grammar: "N m", translation: "walizka", example: "ein schwerer Koffer" }), withExamples);
  assert.equal(good.pass, true, good.reason);
  const none = validateReply(reply({ phrase: "der Koffer", grammar: "N m", translation: "walizka", example: null }), withExamples);
  assert.equal(none.pass, true, none.reason);
  const wrongType = validateReply(reply({ phrase: "der Koffer", grammar: "N m", translation: "walizka", example: ["x"] }), withExamples);
  assert.equal(wrongType.pass, true, "a wrong-typed example is ignored, as phraseforge ignores it");
  // structureOnly names each failed style check in the reason
  const structure = { ...withExamples, structureOnly: true };
  const long = validateReply(reply({ phrase: "der Koffer", grammar: "N m", translation: "walizka", example: "x".repeat(81) }), structure);
  assert.equal(long.pass, false);
  assert.match(long.reason, /exampleShort/);
  const repeat = validateReply(reply({ phrase: "der Koffer", grammar: "N m", translation: "walizka", example: "  der große Koffer " }), structure);
  assert.equal(repeat.pass, false);
  assert.match(repeat.reason, /exampleNew/);
  // and in the scored mode a failed example still fails the case through the style component
  const scoredLong = validateReply(reply({ phrase: "der Koffer", grammar: "N m", translation: "walizka", example: "x".repeat(81) }), withExamples);
  assert.equal(scoredLong.pass, false);
});

test("a rewrite is scored on style: asked for only with a usage, and the expected one when the row has one", () => {
  const base = { ...deu, usage: "die Kinder spielen", structureOnly: true };
  const expectsRewrite = { ...base, phrase: "Kinder", rewrite: "das Kind" };
  const asked = (phrase, rewrite) => reply({ phrase, grammar: "N pl", translation: "dzieci", rewrite });

  assert.equal(validateReply(asked("Kinder", { phrase: "das Kind", grammar: "N n", transcription: null }), expectsRewrite).pass, true);
  const missing = validateReply(asked("Kinder", null), expectsRewrite);
  assert.equal(missing.pass, false);
  assert.match(missing.reason, /rewriteMissing/);
  const other = validateReply(asked("Kinder", { phrase: "der Kind" }), expectsRewrite);
  assert.match(other.reason, /rewriteExpected/);

  const dictionaryForm = { ...base, phrase: "der Koffer" };
  assert.equal(validateReply(reply({ phrase: "der Koffer", grammar: "N m", translation: "walizka", rewrite: null }), dictionaryForm).pass, true);
  const unneeded = validateReply(reply({ phrase: "der Koffer", grammar: "N m", translation: "walizka", rewrite: { phrase: "Koffer" } }), dictionaryForm);
  assert.match(unneeded.reason, /rewriteUnneeded/);

  const noUsage = validateReply(reply({ phrase: "der Koffer", grammar: "N m", translation: "walizka", rewrite: { phrase: "Koffer" } }), { ...dictionaryForm, usage: "" });
  assert.match(noUsage.reason, /rewriteWithUsage/);

  // anything but an object with a phrase is ignored, as phraseforge ignores it
  assert.equal(validateReply(reply({ phrase: "der Koffer", grammar: "N m", translation: "walizka", rewrite: "Koffer" }), dictionaryForm).pass, true);
});

test("a new sense is scored on style: it needs an existing translation, must be new, and the row says whether one is wanted", () => {
  const base = { ...deu, phrase: "Bank", usage: "Geld auf der Bank einzahlen", currentTranslation: "ławka", referenceTranslation: "ławka", translation: "ławka", structureOnly: true };
  const wants = { ...base, sense: true };
  const asked = (newSense) => reply({ phrase: "Bank", grammar: "N f", translation: "ławka", newSense });

  assert.equal(validateReply(asked("bank"), wants).pass, true);
  assert.match(validateReply(asked(null), wants).reason, /senseMissing/);
  assert.match(validateReply(asked(" Ławka "), wants).reason, /senseNew/, "a sense already there is not new, ignoring case");
  assert.match(validateReply(asked("bank"), base).reason, /senseUnneeded/, "the row says the translation covers the usage");
  assert.equal(validateReply(asked(null), base).pass, true);

  const noExisting = { ...base, currentTranslation: "", translation: "" };
  assert.match(validateReply(asked("bank"), noExisting).reason, /senseWithTranslation/);
  // newSense null and nothing in translation: a wanted sense is missing; a wrong-typed newSense is ignored
  assert.match(validateReply(asked(5), wants).reason, /senseMissing/);
});

test("a sense the model put into translation counts, as phraseforge recovers it, when the existing senses are kept", () => {
  const base = { ...deu, phrase: "Bank", usage: "Geld auf der Bank einzahlen", currentTranslation: "ławka", referenceTranslation: "ławka", translation: "ławka", structureOnly: true, sense: true };
  const inTranslation = (translation, newSense = null) => reply({ phrase: "Bank", grammar: "N f", translation, newSense });

  assert.equal(validateReply(inTranslation("bank; ławka"), base).pass, true);
  assert.equal(validateReply(inTranslation("ławka; bank"), base).pass, true);
  assert.match(validateReply(inTranslation("ławka"), base).reason, /senseMissing/);
  assert.match(validateReply(inTranslation("bank"), base).reason, /senseMissing/, "a re-translation that dropped the old sense is not recovered");
  assert.match(validateReply(inTranslation("bank; ławka"), { ...base, sense: false }).reason, /senseUnneeded/);
});

test("the reference answer comes from referenceTranslation when a run carries it, not from the prompt's translation var", () => {
  const vars = { ...deu, translation: "", referenceTranslation: "walizka" };
  const ok = validateReply(reply({ phrase: "der Koffer", grammar: "N m", translation: "walizka" }), vars);
  assert.equal(ok.pass, true);
  const wrong = validateReply(reply({ phrase: "der Koffer", grammar: "N m", translation: "torba" }), vars);
  assert.equal(wrong.pass, false);
});
