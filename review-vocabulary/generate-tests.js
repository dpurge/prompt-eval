const fs = require("fs");
const path = require("path");
const yaml = require("yaml");
const prompts = require("../lib/prompts");
const { formatExamples, formatTranslations } = require("../lib/review-vocabulary");

// One test per case: an entry as phraseforge sends it to the review call and
// the checks a careful reviewer would raise (flags). SMOKE=1 runs the first
// case only, LANGS=deu,fin selects cases by language code.
module.exports = async function () {
  const cases = yaml.parse(fs.readFileSync(path.join(__dirname, "data", "cases.yaml"), "utf8"));
  const langs = process.env.LANGS ? process.env.LANGS.split(",") : null;
  const selected = cases.filter((c) => !langs || langs.includes(c.lang));
  return (process.env.SMOKE ? selected.slice(0, 1) : selected).map((c) => ({
    description: c.id,
    vars: {
      sourceLanguage: c.language,
      phrase: c.phrase,
      grammar: c.grammar || "none",
      transcription: c.transcription || "none",
      examples: formatExamples(c.examples),
      translations: formatTranslations(c.translations),
      // phraseforge gives a language that needs transcription the default snippet
      ...prompts.snippets(c.lang, { transcription: !!c.transcription }),
      expectedFlags: JSON.stringify(c.flags ?? []),
    },
  }));
};
