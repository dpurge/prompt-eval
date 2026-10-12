// Validates one item reply the way phraseforge does before it stores
// anything (phraseforge/internal/ai/itemresponse.go, itemjob.go):
//   - the reply must be plain JSON (a code fence fails, as in phraseforge);
//   - "phrase" and "translation" must be non-blank;
//   - the echoed phrase must equal the item's phrase (trim + NFC);
//   - grammar/transcription only count when the language has that section
//     (grammarPrompt/transcriptionPrompt non-empty) — phraseforge never
//     stores them otherwise.
// Reference scoring (skipped for a row with vars.structureOnly, which has no
// reference answer and only checks the four rules above): translation exact
// after normalization; grammar exact after whitespace collapse;
// transcription Levenshtein similarity >= 0.9.

const style = require("./style-checks");

function normalize(text) {
  return String(text ?? "")
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[.,!?;:'"„“”()]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function levenshtein(a, b) {
  const m = Array.from({ length: a.length + 1 }, () => Array(b.length + 1).fill(0));
  for (let i = 0; i <= a.length; i++) m[i][0] = i;
  for (let j = 0; j <= b.length; j++) m[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      m[i][j] = a[i - 1] === b[j - 1] ? m[i - 1][j - 1] : Math.min(m[i - 1][j] + 1, m[i][j - 1] + 1, m[i - 1][j - 1] + 1);
    }
  }
  return m[a.length][b.length];
}

const trimmed = (v) => (typeof v === "string" ? v.trim() : "");
const collapse = (v) => trimmed(v).replace(/\s+/g, " ");
const fail = (reason, kind) => ({ pass: false, score: 0, reason, namedScores: kind ? { [kind]: 0 } : undefined });

// validateReply checks output (the model's raw reply) against the test's vars.
// senseFromTranslation mirrors ai.senseFromTranslation on normalized senses:
// the reply translation's senses that the existing ones lack, joined with "; ",
// only when the reply keeps every existing sense.
function senseFromTranslation(have, reply) {
  if (!have.length) return "";
  const raw = String(reply ?? "").split(";").map((v) => v.trim()).filter(Boolean);
  const got = raw.map((v) => normalize(v));
  if (!have.every((sense) => got.includes(sense))) return "";
  const added = [];
  raw.forEach((value, i) => {
    if (!have.includes(got[i]) && !added.some((a) => normalize(a) === got[i])) added.push(value);
  });
  return added.join("; ");
}

function validateReply(output, expected) {
  // The reference answer: promptfoo runs carry it as referenceTranslation
  // (their `translation` is the existing translation, see lib/tests.js).
  const reference = expected.referenceTranslation ?? expected.translation;
  let actual;
  try {
    actual = JSON.parse(String(output).trim());
  } catch {
    return fail("Model output is not valid JSON", "json");
  }
  if (actual === null || typeof actual !== "object" || Array.isArray(actual)) {
    return fail("Model output is not a JSON object", "json");
  }

  if (!trimmed(actual.phrase)) return fail('Missing "phrase"', "phrase");
  if (!trimmed(actual.translation)) return fail('Missing "translation"', "translation");
  if (trimmed(actual.phrase).normalize("NFC") !== trimmed(expected.phrase).normalize("NFC")) {
    return fail(`Phrase "${actual.phrase}" does not match the item's phrase "${expected.phrase}"`, "phrase");
  }

  // The style the user wants (lib/style-checks.js). A models item is a phrase
  // or sentence, so the dictionary-casing rules are for vocabulary items only.
  const isModels = expected.itemKind === "models";
  const styleChecks = {
    ...style.translationStyle(actual.translation, { reference, isPhrase: isModels || expected.structureOnly }),
    ...style.notesPolicy(actual.notes, { referenceNotes: expected.notes, targetLanguage: expected.targetLanguage, referenceKnown: !expected.structureOnly && !isModels }),
  };
  // The optional example (phraseforge ignores an unusable one rather than
  // asking for a correction, so these only score the style): a short phrase
  // that is not one of the known examples.
  const example = trimmed(actual.example).normalize("NFC");
  if (example) {
    const chars = [...example].length;
    styleChecks.exampleShort = chars <= 80 ? { ok: true } : { ok: false, reason: `example has ${chars} characters, the limit is 80` };
    const known = String(expected.examples ?? "").split("\n").map((l) => l.replace(/^- /, "").trim().normalize("NFC")).filter(Boolean);
    styleChecks.exampleNew = known.includes(example) ? { ok: false, reason: "example repeats a known one" } : { ok: true };
  }
  // The optional new sense (phraseforge appends it only for a job that may, and
  // only to an existing translation): scored on style only. It needs an existing
  // translation, must be new, and the row says whether one is wanted.
  const existing = trimmed(expected.currentTranslation);
  const senses = existing.split(";").map((v) => normalize(v)).filter(Boolean);
  // Like phraseforge (ai.senseFromTranslation), a sense the model put into
  // "translation" instead counts, when that translation keeps every old sense.
  const newSense = trimmed(actual.newSense) || senseFromTranslation(senses, actual.translation);
  if (newSense) {
    styleChecks.senseWithTranslation = existing ? { ok: true } : { ok: false, reason: "newSense without an existing translation to add to" };
    styleChecks.senseNew = senses.includes(normalize(newSense)) ? { ok: false, reason: `newSense "${newSense}" is already one of the senses` } : { ok: true };
    if (existing && trimmed(expected.usage) && !expected.sense) styleChecks.senseUnneeded = { ok: false, reason: `newSense "${newSense}" although the translation covers the usage` };
  } else if (expected.sense && existing) {
    styleChecks.senseMissing = { ok: false, reason: "no newSense, although the usage shows a meaning the translation lacks" };
  }
  // The optional rewrite (phraseforge ignores an unusable one, and any rewrite
  // for a job without a usage). Scored on style only: it must be asked for only
  // when the usage is there, and when the row expects one it must be that phrase.
  const rewrite = actual.rewrite !== null && typeof actual.rewrite === "object" && !Array.isArray(actual.rewrite) && trimmed(actual.rewrite.phrase) ? actual.rewrite : null;
  const wantedRewrite = trimmed(expected.rewrite);
  if (rewrite) {
    styleChecks.rewriteWithUsage = trimmed(expected.usage) ? { ok: true } : { ok: false, reason: "rewrite without a usage, which phraseforge ignores" };
    if (wantedRewrite) {
      styleChecks.rewriteExpected = normalize(rewrite.phrase) === normalize(wantedRewrite) ? { ok: true } : { ok: false, reason: `rewrite "${rewrite.phrase}", expected "${wantedRewrite}"` };
    } else if (trimmed(expected.usage)) {
      styleChecks.rewriteUnneeded = { ok: false, reason: `rewrite "${rewrite.phrase}" of a phrase that is in dictionary form` };
    }
  } else if (wantedRewrite && trimmed(expected.usage)) {
    styleChecks.rewriteMissing = { ok: false, reason: `no rewrite, expected "${wantedRewrite}"` };
  }
  const needsTranscription = !!trimmed(expected.transcriptionPrompt);
  if (needsTranscription) {
    styleChecks.transcriptionPresent = trimmed(actual.transcription) ? { ok: true } : { ok: false, reason: "no transcription, which this language requires" };
    if (trimmed(actual.transcription)) styleChecks.latinTranscription = style.latinTranscription(actual.transcription);
  }
  const styleEntries = Object.entries(styleChecks);
  const styleFailed = styleEntries.filter(([, c]) => !c.ok);
  const styleComponent = {
    name: "style", weight: 0.2, threshold: 1, score: (styleEntries.length - styleFailed.length) / Math.max(styleEntries.length, 1),
    reason: styleFailed.length ? styleFailed.map(([n, c]) => `${n}: ${c.reason}`).join("; ") : "style ok",
  };

  if (expected.structureOnly) {
    const base = { json: 1, phrase: 1, translation: 1 };
    return {
      pass: styleFailed.length === 0, score: styleComponent.score,
      reason: styleFailed.length ? styleComponent.reason : "structure ok",
      namedScores: { ...base, style: styleComponent.score },
    };
  }

  const components = [];
  const translationCheck = isModels
    ? { ok: style.similarity(normalize(actual.translation), normalize(reference)) >= 0.5 }
    : style.translationMatches(actual.translation, reference);
  components.push({
    name: "translation", weight: 0.6, threshold: 1, score: translationCheck.ok ? 1 : 0,
    reason: `Expected: ${reference}; got: ${actual.translation}`,
  });
  components.push(styleComponent);

  if (trimmed(expected.grammarPrompt)) {
    const ok = collapse(actual.grammar) === collapse(expected.grammar);
    components.push({
      name: "grammar", weight: 0.1, threshold: 1, score: ok ? 1 : 0,
      reason: `Expected: ${expected.grammar ?? ""}; got: ${actual.grammar ?? ""}`,
    });
  }

  if (trimmed(expected.transcriptionPrompt)) {
    const reference = normalize(expected.transcription);
    const hypothesis = normalize(actual.transcription);
    const score = reference === "" && hypothesis === "" ? 1 : 1 - levenshtein(reference, hypothesis) / Math.max(reference.length, hypothesis.length, 1);
    components.push({
      name: "transcription", weight: 0.3, threshold: 0.9, score,
      reason: `Expected: ${expected.transcription ?? ""}; got: ${actual.transcription ?? ""}`,
    });
  }

  if (needsTranscription && trimmed(expected.transcription)) {
    const strict = style.strictTranscription(actual.transcription, expected.transcription);
    components.push({
      name: "transcriptionStrict", weight: 0.2, threshold: 0.85, score: strict.score,
      reason: strict.ok ? "diacritics and case ok" : strict.reason,
    });
  }

  const totalWeight = components.reduce((sum, c) => sum + c.weight, 0);
  const score = components.reduce((sum, c) => sum + c.weight * c.score, 0) / totalWeight;
  return {
    pass: components.every((c) => c.score >= c.threshold),
    score,
    reason: components.map((c) => `${c.name}: ${c.score.toFixed(3)}`).join(", "),
    namedScores: Object.fromEntries(components.map((c) => [c.name, c.score])),
    componentResults: components.map((c) => ({ pass: c.score >= c.threshold, score: c.score, reason: c.reason })),
  };
}

module.exports = { validateReply, normalize, levenshtein };
