// Deterministic checks for the purposes phraseforge calls through
// ai.Service.Generate (free-text output, no JSON schema). Each check returns
// { pass, score, reason, namedScores }; a reply passes when every named
// check passes.
const { levenshtein } = require("./validate-reply");
const S = require("./style-checks");

const lines = (text) => String(text ?? "").split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
// fold lowercases and drops accents, so "Zażółć" matches "zazolc".
const fold = (text) => String(text ?? "").normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();

// promptfoo runs one test per element of an array var, so the builder passes
// list expectations as JSON strings (lib/tests.js, generateTests); a plain
// array is accepted too, for direct calls.
function list(value) {
  if (Array.isArray(value)) return value;
  if (typeof value === "string" && value.trim().startsWith("[")) return JSON.parse(value);
  return [];
}

const FENCE = /```/;
// A reply that talks about the answer instead of being the answer.
const PREAMBLE = /^(here(?:'s| is| are)\b|sure\b|of course\b|certainly\b|okay\b|ok,|oto\b|translation:|transcription:|title:|tłumaczenie:)/i;
const CJK = /[㐀-鿿豈-﫿]/;
const WRAPPING_QUOTE = /^["'«»“”„‘’]|["'«»“”„‘’]$/;
const TRAILING_PUNCTUATION = /[.!?:;,。！？，：；]$/;

function result(checks) {
  const entries = Object.entries(checks);
  const failed = entries.filter(([, check]) => !check.ok);
  const namedScores = Object.fromEntries(entries.map(([name, check]) => [name, check.score ?? (check.ok ? 1 : 0)]));
  return {
    pass: failed.length === 0,
    score: entries.reduce((sum, [name]) => sum + namedScores[name], 0) / entries.length,
    reason: failed.length === 0 ? "all checks ok" : failed.map(([name, check]) => `${name}: ${check.reason}`).join("; "),
    namedScores,
  };
}

const ok = () => ({ ok: true });
const bad = (reason) => ({ ok: false, reason });

// Checks every free-text reply must pass.
function commonChecks(output) {
  const text = String(output ?? "").trim();
  return {
    nonEmpty: text ? ok() : bad("empty reply"),
    noFence: FENCE.test(text) ? bad("contains a code fence") : ok(),
    noPreamble: PREAMBLE.test(text) ? bad(`starts with chatter: "${text.slice(0, 40)}"`) : ok(),
  };
}

// containsAll: every group needs at least one of its alternatives in the text
// (accent- and case-insensitive).
function containsGroups(text, groups) {
  const haystack = fold(text);
  const missing = list(groups).filter((alternatives) => !alternatives.some((a) => haystack.includes(fold(a))));
  return missing.length === 0 ? ok() : bad(`missing ${missing.map((g) => g.join("|")).join(", ")}`);
}

function sameLineCount(output, input) {
  const want = lines(input).length;
  const got = lines(output).length;
  return got === want ? ok() : bad(`${got} lines, want ${want}`);
}

function checkTranslation(output, vars) {
  return result({
    ...commonChecks(output),
    lineCount: sameLineCount(output, vars.content),
    notUntranslated: fold(output).trim() === fold(vars.content).trim() ? bad("reply equals the input") : ok(),
    expectedWords: containsGroups(output, vars.contains),
  });
}

function checkTranscription(output, vars) {
  const strip = (t) => fold(t).replace(/[^a-z0-9]/g, "");
  const reference = strip(vars.reference);
  const hypothesis = strip(output);
  const similarity = 1 - levenshtein(reference, hypothesis) / Math.max(reference.length, hypothesis.length, 1);
  return result({
    ...commonChecks(output),
    lineCount: sameLineCount(output, vars.content),
    romanized: S.latinTranscription(output),
    sentenceCapitals: S.sentenceCapitals(output),
    diacriticsAndCase: S.strictTranscription(output, vars.reference, 0.8),
    similarToReference: similarity >= 0.8 ? { ok: true, score: similarity } : { ok: false, score: similarity, reason: `similarity ${similarity.toFixed(2)} to "${vars.reference}"` },
  });
}

// A proxy for "the title is in the text's language": it reuses at least one
// word (4+ letters) of the text, or at least one Chinese character for
// Chinese text. A title that paraphrases everything fails it, so read a
// failure as "look at this title", not as proof.
function reusesTextVocabulary(title, content) {
  if (CJK.test(content)) {
    const characters = new Set(content.match(new RegExp(CJK.source, "g")));
    return [...title].some((c) => characters.has(c));
  }
  const words = (t) => fold(t).match(/\p{L}{4,}/gu) ?? [];
  const known = new Set(words(content));
  return words(title).some((w) => known.has(w));
}

function checkTitle(output, vars) {
  const text = String(output ?? "").trim();
  return result({
    ...commonChecks(output),
    singleLine: lines(text).length === 1 ? ok() : bad(`${lines(text).length} lines`),
    noWrappingQuotes: WRAPPING_QUOTE.test(text) ? bad(`wrapped in quotes: ${text}`) : ok(),
    noTrailingPunctuation: TRAILING_PUNCTUATION.test(text) ? bad(`ends with punctuation: ${text.slice(-1)}`) : ok(),
    short: text.length <= 100 ? ok() : bad(`${text.length} characters`),
    notTheText: fold(text) === fold(vars.content).trim() ? bad("title is the whole text") : ok(),
    sourceLanguage: reusesTextVocabulary(text, vars.content) ? ok() : bad(`shares no word with the text, so probably not in its language: ${text}`),
  });
}

// keep: strings that must survive cleaning; drop: boilerplate that must go;
// forbid: regexes the reply must not match (e.g. an invented heading).
function processChecks(output, vars) {
  const haystack = fold(output);
  const missing = list(vars.keep).filter((s) => !haystack.includes(fold(s)));
  const leftover = list(vars.drop).filter((s) => haystack.includes(fold(s)));
  const forbidden = list(vars.forbid).filter((pattern) => new RegExp(pattern, "m").test(String(output)));
  return {
    ...commonChecks(output),
    keepsContent: missing.length === 0 ? ok() : bad(`lost: ${missing.join(" | ")}`),
    dropsBoilerplate: leftover.length === 0 ? ok() : bad(`still has: ${leftover.join(" | ")}`),
    noForbiddenPattern: forbidden.length === 0 ? ok() : bad(`matches ${forbidden.join(", ")}`),
  };
}

const checkProcessText = (output, vars) => result(processChecks(output, vars));

// The same rules, and each turn on its own line (vars.turns).
function checkProcessDialog(output, vars) {
  const got = lines(output).length;
  return result({
    ...processChecks(output, vars),
    turnPerLine: got === vars.turns ? ok() : bad(`${got} lines, want ${vars.turns} turns`),
  });
}

// The item-line format of generateVocabulary / generateModels:
//   phrase {grammar} [transcription] = translation   (each part after phrase optional)
const VOCABULARY_LINE = /^(?<phrase>[^{}[\]=]+?)(?:\s+\{(?<grammar>[^{}]+)\})?(?:\s+\[(?<transcription>[^[\]]+)\])?(?:\s+=\s+(?<translation>.+))?$/;
const MODEL_LINE = /^(?<phrase>[^{}[\]=]+?)(?:\s+\[(?<transcription>[^[\]]+)\])?(?:\s+=\s+(?<translation>.+))?$/;
const LIST_MARKER = /^\s*(\d+[.)]|[-*•])\s/;

function parseItemLines(output, lineFormat) {
  const parsed = lines(output).map((line) => ({ line, match: lineFormat.exec(line) }));
  return { parsed, malformed: parsed.filter((p) => !p.match || /\{\s*\}|\[\s*\]/.test(p.line)).map((p) => p.line) };
}

function itemListChecks(output, vars, lineFormat) {
  const { parsed, malformed } = parseItemLines(output, lineFormat);
  const numbered = parsed.filter((p) => LIST_MARKER.test(p.line));
  return {
    ...commonChecks(output),
    lineFormat: malformed.length === 0 ? ok() : bad(`not in the item format: ${malformed.slice(0, 2).join(" || ")}`),
    noListMarkers: numbered.length === 0 ? ok() : bad(`numbered or bulleted: ${numbered[0].line}`),
    enoughItems: parsed.length >= (vars.minItems ?? 3) ? ok() : bad(`${parsed.length} items, want at least ${vars.minItems ?? 3}`),
    parsed,
  };
}

// Words of a text: runs of 3+ letters, except that Chinese, which has no
// spaces, is compared character by character.
const words = (t) => {
  const folded = fold(t);
  return CJK.test(folded) ? [...folded].filter((c) => CJK.test(c)) : folded.match(/\p{L}{3,}/gu) ?? [];
};

function checkGenerateVocabulary(output, vars) {
  const { parsed, ...checks } = itemListChecks(output, vars, VOCABULARY_LINE);
  const text = fold(vars.content);
  const items = parsed.filter((p) => p.match);
  const inText = items.filter((p) => text.includes(fold(p.match.groups.phrase.trim())));
  const share = items.length ? inText.length / items.length : 0;
  const groups = list(vars.lemmas);
  const lineChecks = (name, fn) => {
    const failures = items.map((p) => fn(p.match.groups)).filter((c) => !c.ok);
    return failures.length === 0 ? ok() : bad(`${name}: ${failures[0].reason}`);
  };
  const styleCheck = lineChecks("translation", (g) => {
    const failed = Object.values(S.translationStyle(g.translation ?? "", {})).find((c) => !c.ok);
    return failed ?? ok();
  });
  return result({
    ...checks,
    canonicalTags: lineChecks("tag", (g) => S.canonicalPos(g.grammar)),
    translationStyle: styleCheck,
    transcriptionPresent: vars.needsTranscription
      ? lineChecks("transcription", (g) => (g.transcription ? S.latinTranscription(g.transcription) : bad("missing")))
      : ok(),
    dictionaryForms: groups.length ? S.dictionaryForms(items.map((p) => p.match.groups.phrase.trim()), groups) : ok(),
    phrasesFromText: share >= 0.7 ? { ok: true, score: share } : { ok: false, score: share, reason: `only ${(share * 100).toFixed(0)}% of the phrases occur in the text` },
  });
}

function checkGenerateModels(output, vars) {
  const { parsed, ...checks } = itemListChecks(output, vars, MODEL_LINE);
  const items = parsed.filter((p) => p.match);
  const braces = parsed.filter((p) => /[{}]/.test(p.line));
  const known = new Set(words(vars.content));
  const related = items.filter((p) => words(p.match.groups.phrase).some((w) => known.has(w)));
  const relatedShare = items.length ? related.length / items.length : 0;
  const lengths = items.map((p) => [...p.match.groups.phrase.trim()].length);
  const pairs = lengths.slice(1).map((n, i) => n >= lengths[i]);
  const progressive = pairs.length ? pairs.filter(Boolean).length / pairs.length : 0;
  const modelLines = (name, fn) => {
    const failures = items.map((p) => fn(p.match.groups)).filter((c) => !c.ok);
    return failures.length === 0 ? ok() : bad(`${name}: ${failures[0].reason}`);
  };
  return result({
    ...checks,
    fewKeyPhrases: items.length <= 8 ? ok() : bad(`${items.length} phrases; only the key ones, at most 8`),
    transcriptionPresent: vars.needsTranscription
      ? modelLines("transcription", (g) => (g.transcription ? S.latinTranscription(g.transcription) : bad("missing")))
      : ok(),
    translationStyle: modelLines("translation", (g) => {
      const failed = Object.values(S.translationStyle(g.translation ?? "", { isPhrase: true })).find((c) => !c.ok);
      return failed ?? ok();
    }),
    noGrammarBraces: braces.length === 0 ? ok() : bad(`has {grammar}, which models do not use: ${braces[0].line}`),
    usesTextVocabulary: relatedShare >= 0.5 ? { ok: true, score: relatedShare } : { ok: false, score: relatedShare, reason: `only ${(relatedShare * 100).toFixed(0)}% of the phrases share a word with the text` },
    progressivelyLonger: progressive >= 0.6 ? { ok: true, score: progressive } : { ok: false, score: progressive, reason: `only ${(progressive * 100).toFixed(0)}% of adjacent phrases get longer or stay as long` },
  });
}

const CHECKS = {
  translation: checkTranslation,
  transcription: checkTranscription,
  title: checkTitle,
  processText: checkProcessText,
  processDialog: checkProcessDialog,
  generateVocabulary: checkGenerateVocabulary,
  generateModels: checkGenerateModels,
};

function checkGenerate(kind, output, vars) {
  const check = CHECKS[kind];
  if (!check) throw new Error(`no checks for generate kind "${kind}" (known: ${Object.keys(CHECKS).join(", ")})`);
  return check(output, vars);
}

module.exports = { checkGenerate, lines, fold, list, CHECKS, VOCABULARY_LINE, MODEL_LINE };
