const fs = require("fs");
const path = require("path");
const yaml = require("yaml");
const { formatCandidates } = require("../lib/check-vocabulary");

// One test per case: the candidates laid out as phraseforge sends them and the
// expected verdicts. SMOKE=1 runs the first case only, LANGS=arb,deu selects
// cases by language code (the prefix of the id), like the other suites.
module.exports = async function () {
  const cases = yaml.parse(fs.readFileSync(path.join(__dirname, "data", "cases.yaml"), "utf8"));
  const langs = process.env.LANGS ? process.env.LANGS.split(",") : null;
  const selected = cases.filter((c) => !langs || langs.includes(c.id.split("-")[0]));
  return (process.env.SMOKE ? selected.slice(0, 1) : selected).map((c) => ({
    description: c.id,
    vars: {
      sourceLanguage: c.language,
      candidates: formatCandidates(c.items),
      expected: JSON.stringify(c.items.map((item) => ({ example: item.expected, sense: item.sense === true }))),
    },
  }));
};
