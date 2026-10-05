// Test builders shared by the item suites. Vars follow phraseforge's item
// prompt placeholders ({{sourceLanguage}}, {{targetLanguage}}, {{phrase}},
// {{grammarPrompt}}, {{transcriptionPrompt}}).
const fs = require("fs");
const path = require("path");
const yaml = require("yaml");

const SECTIONS_DIR = path.join(__dirname, "..", "vocabulary-translation", "prompts");

// Source languages: their name in prompts and optional prompt sections
// (phraseforge's Admin > LLM > Language sections).
// Names are the ones phraseforge sends: the `name` column of its language
// table (internal/db/schema.sql).
const SOURCES = {
  arb: { name: "Standard Arabic", grammar: "arb-grammar.txt", transcription: "arb-transcription.txt" },
  cmn: { name: "Mandarin Chinese", grammar: "cmn-grammar.txt", transcription: "cmn-transcription.txt" },
  dan: { name: "Danish", grammar: "dan-grammar.txt", transcription: null },
  deu: { name: "German", grammar: "deu-grammar.txt", transcription: null },
  fin: { name: "Finnish", grammar: "fin-grammar.txt", transcription: null },
  fra: { name: "French", grammar: "fra-grammar.txt", transcription: null },
  fas: { name: "Persian", grammar: "fas-grammar.txt", transcription: "fas-transcription.txt" },
  ell: { name: "Modern Greek", grammar: "ell-grammar.txt", transcription: null },
  grc: { name: "Ancient Greek", grammar: "grc-grammar.txt", transcription: null },
  heb: { name: "Hebrew", grammar: "heb-grammar.txt", transcription: "heb-transcription.txt" },
  ind: { name: "Indonesian", grammar: "ind-grammar.txt", transcription: null },
  ita: { name: "Italian", grammar: "ita-grammar.txt", transcription: null },
  jpn: { name: "Japanese", grammar: "jpn-grammar.txt", transcription: "jpn-transcription.txt" },
  kor: { name: "Korean", grammar: "kor-grammar.txt", transcription: null },
  lat: { name: "Latin", grammar: "lat-grammar.txt", transcription: null },
  nld: { name: "Dutch", grammar: "nld-grammar.txt", transcription: null },
  ron: { name: "Romanian", grammar: "ron-grammar.txt", transcription: null },
  spa: { name: "Spanish", grammar: "spa-grammar.txt", transcription: null },
  swa: { name: "Swahili", grammar: "swa-grammar.txt", transcription: null },
  swe: { name: "Swedish", grammar: "swe-grammar.txt", transcription: null },
  tgl: { name: "Tagalog", grammar: "tgl-grammar.txt", transcription: null },
  tur: { name: "Turkish", grammar: "tur-grammar.txt", transcription: null },
  ukr: { name: "Ukrainian", grammar: "ukr-grammar.txt", transcription: null },
  vie: { name: "Vietnamese", grammar: "vie-grammar.txt", transcription: null },
  yid: { name: "Yiddish", grammar: "yid-grammar.txt", transcription: "yid-transcription.txt" },
};

// LANGS=arb,cmn keeps only the tests of those source languages, for a quick
// run of one language (combine with SMOKE=1). Unset keeps every language.
const wantsLanguage = (code) => {
  if (!process.env.LANGS) return true;
  return process.env.LANGS.split(",").map((l) => l.trim()).filter(Boolean).includes(code);
};

// Target languages are the site locales' PromptName in phraseforge's
// i18n.Locales.
const TARGETS = { pol: "Polish", eng: "English" };

// readSection returns a section file's text, or "" when the language has none
// — phraseforge renders a missing section as "" too. Sections are rendered
// as phraseforge stores them (LF line endings).
function readSection(file) {
  if (!file) return "";
  return fs.readFileSync(path.join(SECTIONS_DIR, file), "utf8").replace(/\r\n/g, "\n");
}

function sectionVars(language, { grammar }) {
  const source = SOURCES[language];
  if (!source) throw new Error(`unknown source language "${language}" (known: ${Object.keys(SOURCES).join(", ")})`);
  return {
    sourceLanguage: source.name,
    grammarPrompt: grammar ? readSection(source.grammar) : "",
    transcriptionPrompt: readSection(source.transcription),
  };
}

// referenceTests reads data/<src>-<tgt>.yaml files, whose rows carry reference
// answers (translation, grammar, transcription).
function referenceTests(dataDir, opts = {}) {
  const grammar = opts.grammar !== false;
  return fs.readdirSync(dataDir).filter((f) => f.endsWith(".yaml")).sort().flatMap((file) => {
    const name = path.basename(file, ".yaml");
    const [src, tgt] = name.split("-");
    if (!wantsLanguage(src)) return [];
    if (!TARGETS[tgt]) throw new Error(`${file}: unknown target language "${tgt}"`);
    const rows = yaml.parse(fs.readFileSync(path.join(dataDir, file), "utf8"));
    // SMOKE=1 keeps the first row of each language
    return rows.filter((row, i) => !process.env.SMOKE || i === 0).map((row) => ({
      description: `${name}/${row.id}`,
      vars: {
        ...Object.fromEntries(Object.entries(row).filter(([, value]) => value !== null)),
        ...sectionVars(src, { grammar }),
        ...(opts.itemKind ? { itemKind: opts.itemKind } : {}),
        targetLanguage: TARGETS[tgt],
      },
    }));
  });
}

// structureTests reads a dataset of phrases without reference answers and
// makes one structure-only test per phrase and target language. With
// opts.grammar false the grammar section is left empty, as for a models item
// (whose template has no grammar placeholder). SMOKE=1 keeps only rows
// marked smoke: true.
function structureTests(file, opts) {
  const rows = yaml.parse(fs.readFileSync(file, "utf8"));
  const dataset = path.basename(file, ".yaml");
  return rows
    .filter((row) => !process.env.SMOKE || row.smoke)
    .filter((row) => wantsLanguage(row.language))
    .flatMap((row) =>
      Object.entries(TARGETS).map(([tgt, targetName]) => ({
        description: `${dataset}/${row.category}/${row.id}->${tgt}`,
        vars: {
          id: row.id,
          category: row.category,
          phrase: row.phrase,
          structureOnly: true,
          ...sectionVars(row.language, { grammar: opts.grammar }),
          targetLanguage: targetName,
        },
      }))
    );
}

// correctionTests makes one test per (base case x way the reply can be
// rejected): the conversation phraseforge sends on its correction call (see
// lib/correction.js). kind is "vocabulary" or "models". SMOKE=1 keeps the
// first reference row per language, the smoke robustness rows and only the
// variants marked smoke. The score is whether the corrected reply passes the
// same structure checks as the first reply, i.e. the one-round fix rate.
function correctionTests(kind) {
  const { variants, conversation } = require("./correction");
  const root = path.join(__dirname, "..");
  const withGrammar = kind === "vocabulary";
  const template = fs.readFileSync(
    path.join(root, withGrammar ? "vocabulary-translation" : "models-item", "prompts", "system.txt"), "utf8");
  const robustness = structureTests(path.join(root, "datasets", "phrase-robustness.yaml"), { grammar: withGrammar })
    .filter((t) => ["quotes", "punctuation", "unicode"].includes(t.vars.category));
  const bases = withGrammar
    ? [
        ...referenceTests(path.join(root, "vocabulary-translation", "data")).filter((t) => !process.env.SMOKE || /-001$/.test(t.description)),
        ...robustness,
      ]
    : [...structureTests(path.join(root, "datasets", "model-patterns.yaml"), { grammar: false }), ...robustness];

  return bases.flatMap((base) =>
    variants(kind, base.vars)
      .filter((v) => !process.env.SMOKE || v.smoke)
      .map((v) => ({
        description: `correction/${v.failure}/${v.id}/${base.description}`,
        vars: { ...base.vars, structureOnly: true, messages: conversation(template, base.vars, v) },
      })));
}

// generateTests makes the tests of one ai.Service.Generate purpose: the call
// phraseforge sends is a system message (the deployed prompt) and a user
// message of the form ai.userMessageTemplate. Source and target are the
// values the real callers pass: a language code ("deu"), a locale code
// ("pl"), or a sentinel ("title", "transcription", "process_text").
// Everything else in a dataset row (the expectations) is passed to the checks
// as a var. SMOKE=1 keeps rows marked smoke: true; LANGS filters languages.
function generateTests(kind) {
  const root = path.join(__dirname, "..");
  const system = fs.readFileSync(path.join(root, "generate", "prompts", `${kind}.txt`), "utf8");
  const rows = yaml.parse(fs.readFileSync(path.join(root, "datasets", `generate-${kind}.yaml`), "utf8"));
  // Dictionary forms the vocabulary of a row must contain (alternatives per form).
  const lemmaFile = path.join(root, "datasets", "vocabulary-lemmas.yaml");
  const lemmas = fs.existsSync(lemmaFile) ? yaml.parse(fs.readFileSync(lemmaFile, "utf8")) : {};
  return rows
    .filter((row) => !process.env.SMOKE || row.smoke)
    .filter((row) => wantsLanguage(row.language))
    .map((row) => {
      const { id, language, target, contentType, smoke, ...expectations } = row;
      if (kind === "generateVocabulary" && lemmas[id]) expectations.lemmas = lemmas[id];
      expectations.needsTranscription = Boolean(SOURCES[language] && SOURCES[language].transcription);
      const user = `Source language: ${language}\nTarget language: ${target}\nContent type: ${contentType ?? "text"}\n\n${row.content}`;
      return {
        description: `generate-${kind}/${id}`,
        vars: {
          // promptfoo would fan an array var out into one test per element
          ...Object.fromEntries(Object.entries(expectations).map(([k, v]) => [k, Array.isArray(v) ? JSON.stringify(v) : v])),
          kind,
          messages: [
            { role: "system", content: system },
            { role: "user", content: user },
          ],
        },
      };
    });
}

module.exports = { SOURCES, TARGETS, wantsLanguage, referenceTests, structureTests, correctionTests, generateTests };
