// Builds the conversations phraseforge sends when an item reply fails
// validation (phraseforge/internal/ai/retry.go, runWithCorrection): the
// original prompt, the rejected reply as an assistant turn, then a user turn
// carrying the exact validation error. The error strings reproduce the ones
// in phraseforge/internal/ai/itemresponse.go.

// Equals correctionTemplate in retry.go (npm run check-sync verifies).
const CORRECTION_TEMPLATE = "Your previous reply was rejected: {{error}}\nReturn only the corrected JSON object.";

const WHAT = { vocabulary: "vocabulary item response", models: "models item response" };

// renderItemPrompt mirrors ai.renderItemPrompt: one pass, so text inside a
// value is never expanded again.
function renderItemPrompt(template, vars) {
  const values = {
    sourceLanguage: vars.sourceLanguage,
    targetLanguage: vars.targetLanguage,
    phrase: vars.phrase,
    grammarPrompt: vars.grammarPrompt ?? "",
    transcriptionPrompt: vars.transcriptionPrompt ?? "",
  };
  return template.replace(/\{\{(sourceLanguage|targetLanguage|phrase|grammarPrompt|transcriptionPrompt)\}\}/g, (_, name) => values[name]);
}

// goQuote is Go's %q for the printable text used here.
function goQuote(text) {
  const escapes = { "\\": "\\\\", '"': '\\"', "\n": "\\n", "\t": "\\t", "\r": "\\r" };
  return '"' + text.replace(/[\\"\n\t\r]/g, (c) => escapes[c]) + '"';
}

const errors = {
  invalidJson: (kind, goMessage) => `${WHAT[kind]}: invalid JSON: ${goMessage}`,
  missing: (kind, field) => `${WHAT[kind]}: missing ${goQuote(field)}`,
  wrongType: (kind, field, got) => `${WHAT[kind]}: ${goQuote(field)} must be a string or null, got ${got}`,
  mismatch: (kind, got, stored) => `${WHAT[kind]}: phrase ${goQuote(got.trim())} does not match the item's phrase ${goQuote(stored)}`,
};

function correctionMessage(error) {
  return CORRECTION_TEMPLATE.replace("{{error}}", () => error);
}

const nfc = (text) => text.trim().normalize("NFC");

// A mutation of a phrase that a model could plausibly echo back wrongly;
// null when it does not change the phrase (so it would not be a mismatch).
const MISMATCHES = {
  "drop-first-word": (p) => {
    const words = p.trim().split(/\s+/);
    return words.length > 1 ? words.slice(1).join(" ") : null;
  },
  "toggle-first-case": (p) => {
    const first = p.trim()[0];
    if (!first || first.toLowerCase() === first.toUpperCase()) return null;
    const flipped = first === first.toUpperCase() ? first.toLowerCase() : first.toUpperCase();
    return flipped + p.trim().slice(1);
  },
  "strip-punctuation": (p) => p.replace(/[.,!?;:"'«»“”„¿¡！？，。：；（）()]/g, "").trim() || null,
  "drop-accents": (p) => p.normalize("NFD").replace(/\p{M}/gu, "").normalize("NFC"),
};

// replyFor builds the model's reply object for a base case, with the phrase
// replaced by `phrase`.
function replyFor(kind, base, phrase) {
  const translation = base.translation ?? "(translation)";
  if (kind === "models") return { phrase, transcription: base.transcription ?? "", translation };
  return { phrase, grammar: base.grammar ?? "", transcription: base.transcription ?? "", translation, notes: "" };
}

// variants lists every way a reply to `base` can be rejected, as
// { id, failure, raw, error, smoke }. `base` carries the test vars
// (phrase, optional reference translation/grammar/transcription).
function variants(kind, base) {
  const out = [];
  const good = replyFor(kind, base, base.phrase);

  const mutations = { ...MISMATCHES };
  if (base.translation) mutations["translated-phrase"] = () => base.translation;
  for (const [id, mutate] of Object.entries(mutations)) {
    const phrase = mutate(base.phrase);
    if (phrase === null || nfc(phrase) === nfc(base.phrase)) continue;
    out.push({
      id, failure: "phrase-mismatch", smoke: id === "translated-phrase" || id === "strip-punctuation",
      raw: JSON.stringify(replyFor(kind, base, phrase)),
      error: errors.mismatch(kind, phrase, base.phrase),
    });
  }

  const json = JSON.stringify(good);
  out.push({ id: "code-fence", failure: "invalid-json", smoke: true,
    raw: "```json\n" + JSON.stringify(good, null, 2) + "\n```",
    error: errors.invalidJson(kind, "invalid character '`' looking for beginning of value") });
  out.push({ id: "prose-prefix", failure: "invalid-json", smoke: false,
    raw: "Here is the translation: " + json,
    error: errors.invalidJson(kind, "invalid character 'H' looking for beginning of value") });
  out.push({ id: "trailing-comma", failure: "invalid-json", smoke: false,
    raw: json.replace(/}$/, ",}"),
    error: errors.invalidJson(kind, "invalid character '}' looking for beginning of object key string") });
  out.push({ id: "truncated", failure: "invalid-json", smoke: false,
    raw: json.slice(0, -2),
    error: errors.invalidJson(kind, "unexpected end of JSON input") });

  out.push({ id: "empty-translation", failure: "missing-field", smoke: true,
    raw: JSON.stringify({ ...good, translation: "" }),
    error: errors.missing(kind, "translation") });

  if (kind === "models") {
    out.push({ id: "transcription-object", failure: "wrong-type", smoke: false,
      raw: JSON.stringify({ ...good, transcription: { pinyin: base.transcription ?? "x" } }),
      error: errors.wrongType(kind, "transcription", "object") });
  } else {
    out.push({ id: "grammar-array", failure: "wrong-type", smoke: false,
      raw: JSON.stringify({ ...good, grammar: String(good.grammar || "N").split(" ") }),
      error: errors.wrongType(kind, "grammar", "array") });
  }
  return out;
}

// conversation is the message list phraseforge sends on the correction call.
function conversation(promptTemplate, base, variant) {
  return [
    { role: "user", content: renderItemPrompt(promptTemplate, base) },
    { role: "assistant", content: variant.raw },
    { role: "user", content: correctionMessage(variant.error) },
  ];
}

module.exports = { CORRECTION_TEMPLATE, renderItemPrompt, goQuote, errors, correctionMessage, variants, conversation };
