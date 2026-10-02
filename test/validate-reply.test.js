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

test("a wrong translation fails; accents and case are forgiven", () => {
  assert.equal(validateReply(reply({ phrase: "der Koffer", grammar: "N m", translation: "kufer" }), deu).pass, false);
  assert.equal(validateReply(reply({ phrase: "der Koffer", grammar: "N m", translation: "WALIZKA." }), deu).pass, true);
});

test("grammar counts only when the language has a grammar section", () => {
  const noSection = { ...deu, grammarPrompt: "" };
  assert.equal(validateReply(reply({ phrase: "der Koffer", grammar: "wrong", translation: "walizka" }), noSection).pass, true);
  assert.equal(validateReply(reply({ phrase: "der Koffer", grammar: "wrong", translation: "walizka" }), deu).pass, false);
});

test("transcription is scored by similarity >= 0.9 only with a section", () => {
  const good = validateReply(reply({ phrase: "名字", grammar: "N", transcription: "mingzi", translation: "imię" }), cmn);
  assert.equal(good.pass, true);
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
