const { test } = require("node:test");
const assert = require("node:assert/strict");
const { build, conflicts, undefinedInExamples } = require("../scripts/grammar-tags");

// Every grammar tag can be looked up: it means one thing in every language (tags are
// case sensitive: N is a noun, n is neuter) and one meaning has one tag.
test("every grammar tag has one meaning and every meaning one tag", () => {
  assert.deepEqual(conflicts(build()), []);
});

test("the tags a snippet uses in its examples are defined in it, apart from the data after a noun", () => {
  const fs = require("node:fs");
  const path = require("node:path");
  const root = path.join(__dirname, "..", "prompt", "phraseforge", "lang");
  const loose = {};
  for (const lang of fs.readdirSync(root)) {
    const file = path.join(root, lang, "snippet", "grammar.txt");
    if (!fs.existsSync(file)) continue;
    const undef = undefinedInExamples(fs.readFileSync(file, "utf8"));
    if (undef.length) loose[lang] = undef;
  }
  // vie lists the classifier word after the noun (N con), as cmn lists the measure word
  assert.deepEqual(loose, { vie: ["con"] });
});

test("the canonical parts of speech of the eval are tags of the default snippet", () => {
  const fs = require("node:fs");
  const path = require("node:path");
  const text = fs.readFileSync(path.join(__dirname, "..", "prompt", "phraseforge", "default", "snippet", "grammar.txt"), "utf8");
  for (const tag of ["N", "V", "Adj", "Adv", "Pron", "Prep", "Conj", "Num", "Part", "Ph"]) {
    assert.match(text, new RegExp(`^\\s+${tag} = `, "m"), `the default snippet does not define ${tag}`);
  }
});
