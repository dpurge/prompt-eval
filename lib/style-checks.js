// Deterministic checks for the style the user wants from the prompts, shared
// by the item suites (lib/validate-reply.js) and the generate suites
// (lib/generate-checks.js). Every check returns { ok, reason? }; none calls a
// model. The rules:
//   translations  like a dictionary's: not capitalized unless a name, senses
//                 joined by "; " (never "/"), nothing in parentheses;
//   notes         only when needed (the reference says so), in the language
//                 of the translation, never English for a Polish reader;
//   transcription Latin script only with Latin punctuation, every diacritic,
//                 capitalized as normal text, close to the reference;
//   vocabulary    dictionary forms, tagged with the canonical POS tags.

const ok = () => ({ ok: true });
const bad = (reason) => ({ ok: false, reason });

const nfc = (t) => String(t ?? "").normalize("NFC");
// fold lowercases and drops accents (also Arabic/Hebrew marks), so a
// vocalized phrase matches its unvocalized form.
const fold = (t) => String(t ?? "").normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
const trimmed = (v) => (typeof v === "string" ? v.trim() : "");

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
const similarity = (a, b) => (a === "" && b === "" ? 1 : 1 - levenshtein(a, b) / Math.max(a.length, b.length, 1));

// ---- translations ----------------------------------------------------------

const senses = (translation) => String(translation ?? "").split(";").map((s) => s.trim()).filter(Boolean);

// Translation of a word or short phrase. reference (optional) is the expected
// translation: a rule is waived where the reference itself does what it
// forbids (a name that is capitalized, a "/" that belongs to the word).
// isPhrase skips the dictionary-casing rules, which are for single words.
function translationStyle(translation, { reference, isPhrase } = {}) {
  const text = trimmed(translation);
  const ref = trimmed(reference);
  const checks = {};
  checks.noSlashSeparator = text.includes("/") && !ref.includes("/") ? bad(`uses "/" between senses: ${text}`) : ok();
  checks.noParentheses = /[()]/.test(text) && !/[()]/.test(ref) ? bad(`has a parenthetical (it belongs in notes, if anywhere): ${text}`) : ok();
  checks.senseSeparator = /\s;|;(?!\s)|;\s{2,}/.test(text) ? bad(`senses must be joined by "; ": ${text}`) : ok();
  if (!isPhrase && ref) {
    const refFirst = senses(ref)[0] ?? "";
    const startsUpper = (s) => /^\p{Lu}/u.test(s);
    const allowedUpper = startsUpper(refFirst);
    const upper = senses(text).filter((s) => startsUpper(s));
    checks.lowercaseUnlessName = upper.length && !allowedUpper ? bad(`capitalized like a sentence: ${upper.join(" | ")}`) : ok();
    checks.noFinalPunctuation = /[.!?]$/.test(text) && !/[.!?]$/.test(ref) ? bad(`ends with punctuation: ${text}`) : ok();
  }
  return checks;
}

// translationMatches: the reference's primary sense is one of the reply's
// senses (accent- and case-insensitive).
function translationMatches(translation, reference) {
  const want = fold(senses(reference)[0] ?? "").replace(/[.,!?;:'"„“”()]/g, "").trim();
  if (!want) return ok();
  const got = senses(translation).map((s) => fold(s).replace(/[.,!?;:'"„“”()]/g, "").trim());
  return got.includes(want) ? ok() : bad(`expected the sense "${senses(reference)[0]}" in: ${translation}`);
}

// ---- notes -----------------------------------------------------------------

const ENGLISH_WORDS = new Set(("the of is a an to and or in on for with as by from that this it its are was be been means mean used use " +
  "usually often literally word verb noun adjective sense when which also not only can may form plural singular meaning refers refer " +
  "commonly typically means colloquial formal informal sometimes").split(" "));

// isEnglish is a proxy: at least two common English words making up a fifth
// or more of the words. A Polish note shares almost none of them.
function isEnglish(text) {
  const words = fold(text).match(/\p{L}+/gu) ?? [];
  if (words.length === 0) return false;
  const hits = words.filter((w) => ENGLISH_WORDS.has(w)).length;
  return hits >= 2 && hits / words.length >= 0.2;
}

// A note is added only where the reference has one (referenceNotes), and for a
// Polish reader it is not English.
function notesPolicy(notes, { referenceNotes, targetLanguage, referenceKnown } = {}) {
  const note = trimmed(notes);
  const checks = {};
  checks.noNeedlessNote = referenceKnown && !trimmed(referenceNotes) && note ? bad(`a note where none is needed: ${note}`) : ok();
  checks.noteLanguage = note && targetLanguage === "Polish" && isEnglish(note) ? bad(`the note is in English: ${note}`) : ok();
  return checks;
}

// ---- transcription ---------------------------------------------------------

// Punctuation that belongs to the source script, and typographic quotes that
// stand in for the hamza/ayn letters, which are ʾ and ʿ.
const FOREIGN_PUNCTUATION = /[，。、：；？！（）「」『』《》“”„«»‹›‘’،؛؟״׳।۔…]/u;
const NON_LATIN_LETTER = /[\p{L}--\p{Script=Latin}--\p{Lm}]/v;

function latinTranscription(transcription) {
  const text = nfc(transcription);
  const foreignLetter = text.match(NON_LATIN_LETTER);
  if (foreignLetter) return bad(`has a letter of another script (${foreignLetter[0]}): ${text}`);
  const punctuation = text.match(FOREIGN_PUNCTUATION);
  if (punctuation) return bad(`has non-Latin punctuation (${punctuation[0]}); use , . ! ? : ; ' " ( ): ${text}`);
  return ok();
}

// Strict similarity: diacritics and case count (the lenient comparison in the
// item and generate checks ignores both).
function strictTranscription(transcription, reference, threshold = 0.85) {
  const want = nfc(reference).replace(/\s+/g, " ").trim();
  const got = nfc(transcription).replace(/\s+/g, " ").trim();
  const score = similarity(want, got);
  return score >= threshold ? { ok: true, score } : { ok: false, score, reason: `similarity ${score.toFixed(2)} (diacritics and case count) to "${want}", got "${got}"` };
}

// Capitalized as in normal text: the first letter of every sentence is upper
// case (a line start, or after . ! ? and a space).
function sentenceCapitals(transcription) {
  const text = nfc(transcription);
  const starts = [...text.matchAll(/(?:^|\n|[.!?]\s+)(\p{L})/gmu)].map((m) => m[1]);
  const wrong = starts.filter((c) => c !== c.toUpperCase() || c === c.toLowerCase());
  return wrong.length === 0 ? ok() : bad(`a sentence starts with a lower-case letter (${wrong[0]}): ${text.slice(0, 60)}`);
}

// ---- vocabulary lines ------------------------------------------------------

const POS_TAGS = new Set(["N", "V", "Adj", "Adv", "Pron", "Prep", "Conj", "Num", "Part", "Interj", "Phrase"]);

// The first token of a grammar tag is one of the canonical parts of speech.
function canonicalPos(grammar) {
  const first = trimmed(grammar).split(/\s+/)[0];
  if (!first) return ok();
  return POS_TAGS.has(first) ? ok() : bad(`"${first}" is not a canonical part of speech (${[...POS_TAGS].join(" ")})`);
}

// Dictionary forms: every group of alternatives has one that equals a phrase
// (accent-insensitive, so a vocalized form matches an unvocalized one).
function dictionaryForms(phrases, groups) {
  const have = new Set(phrases.map((p) => fold(p).trim()));
  const missing = groups.filter((alternatives) => !alternatives.some((a) => have.has(fold(a).trim())));
  return missing.length === 0 ? ok() : bad(`not in dictionary form, or missing: ${missing.map((g) => g.join("|")).join(", ")}`);
}

module.exports = {
  fold, nfc, levenshtein, similarity, senses,
  translationStyle, translationMatches, isEnglish, notesPolicy,
  latinTranscription, strictTranscription, sentenceCapitals, canonicalPos, dictionaryForms,
};
