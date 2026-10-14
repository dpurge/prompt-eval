// Builds the grammar tag registry from every grammar snippet under
// prompt/phraseforge (the default one and each language's) and checks that it
// can be looked up by tag: a tag means one thing everywhere, and one meaning has
// one tag. Tags are case sensitive (N is a noun, n is neuter).
//
//   node scripts/grammar-tags.js           print the registry and any conflicts
//   node scripts/grammar-tags.js --check   exit 1 when there is a conflict
//
// A tag is defined by a line "  TAG = meaning" in a snippet; the meaning is the
// text before the first "(" or ":" (so "N = Noun (Substantiv): Haus" is "noun").
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..", "prompt", "phraseforge");

function snippetFiles(exclude = []) {
  const files = [{ name: "default", file: path.join(root, "default", "snippet", "grammar.txt") }];
  const langDir = path.join(root, "lang");
  for (const lang of fs.readdirSync(langDir).sort()) {
    const file = path.join(langDir, lang, "snippet", "grammar.txt");
    if (fs.existsSync(file) && !exclude.includes(lang)) files.push({ name: lang, file });
  }
  return files;
}

const clean = (text) => text.toLowerCase().replace(/\s+/g, " ").trim();

function meaningOf(raw) {
  return clean(raw.split(/[(:]/)[0])
    .replace(/^fixed (phrase|expression)( or idiom)?$/, "phrase")
    .replace(/^phrase, fixed expression or idiom$/, "phrase")
    // the same part of speech under a language's own wording
    .replace(/^preposition \/ coverb$/, "preposition")
    .replace(/^modal( verb \/ expression)?$/, "modal verb")
    .replace(/^definite article$/, "article");
}

// definitions returns [{tag, meaning, line}] of a snippet's tag lines.
function definitions(text) {
  const out = [];
  text.split("\n").forEach((line, i) => {
    const m = line.match(/^\s{2,}([A-Za-z][A-Za-z]*) = (.+)$/);
    if (m) out.push({ tag: m[1], meaning: meaningOf(m[2]), line: i + 1 });
  });
  return out;
}

// undefinedInExamples lists the tag-like words of the "phrase -> tags" example lines
// that the snippet itself does not define. The words after N that are data (a
// measure word, an article) are not tags, so this is a note, not a conflict.
function undefinedInExamples(text) {
  const defined = new Set(definitions(text).map((d) => d.tag));
  const found = new Set();
  for (const line of text.split("\n")) {
    const m = line.match(/ -> (.+)$/);
    if (!m) continue;
    for (const word of m[1].trim().split(/\s+/)) if (/^[A-Za-z]+$/.test(word) && !defined.has(word)) found.add(word);
  }
  return [...found];
}

function build(exclude = []) {
  const byTag = new Map();
  const byMeaning = new Map();
  const within = [];
  for (const { name, file } of snippetFiles(exclude)) {
    const seen = new Map();
    for (const d of definitions(fs.readFileSync(file, "utf8"))) {
      if (seen.has(d.tag) && seen.get(d.tag) !== d.meaning) within.push(`${name}: the tag "${d.tag}" is defined twice, as "${seen.get(d.tag)}" and as "${d.meaning}" (line ${d.line})`);
      seen.set(d.tag, d.meaning);
      if (!byTag.has(d.tag)) byTag.set(d.tag, new Map());
      const meanings = byTag.get(d.tag);
      meanings.set(d.meaning, [...(meanings.get(d.meaning) || []), name]);
      if (!byMeaning.has(d.meaning)) byMeaning.set(d.meaning, new Map());
      const tags = byMeaning.get(d.meaning);
      tags.set(d.tag, [...(tags.get(d.tag) || []), name]);
    }
  }
  return { byTag, byMeaning, within };
}

function conflicts({ byTag, byMeaning, within }) {
  const list = [...within];
  for (const [tag, meanings] of byTag) {
    if (meanings.size > 1) list.push(`the tag "${tag}" has ${meanings.size} meanings: ${[...meanings].map(([m, langs]) => `"${m}" (${langs.join(", ")})`).join("; ")}`);
  }
  for (const [meaning, tags] of byMeaning) {
    if (tags.size > 1) list.push(`"${meaning}" has ${tags.size} tags: ${[...tags].map(([t, langs]) => `${t} (${langs.join(", ")})`).join("; ")}`);
  }
  return list;
}

if (require.main === module) {
  const registry = build();
  if (!process.argv.includes("--check")) {
    console.log("tag\tmeaning\tused in");
    for (const [tag, meanings] of [...registry.byTag].sort((a, b) => a[0].localeCompare(b[0], "en", { caseFirst: "upper" }))) {
      for (const [meaning, langs] of meanings) console.log(`${tag}\t${meaning}\t${langs.length > 8 ? `${langs.length} languages` : langs.join(", ")}`);
    }
    console.log("");
  }
  for (const { name, file } of snippetFiles()) {
    const text = fs.readFileSync(file, "utf8");
    const undef = undefinedInExamples(text).filter((w) => !definitions(text).some((d) => d.tag === w));
    // gender and similar tags listed as "m = masculine" are definitions too; only report the rest
    if (undef.length) console.log(`note: ${name}: example tags not defined in the snippet: ${undef.join(", ")}`);
  }
  const found = conflicts(registry);
  if (found.length) {
    console.error(`${found.length} conflict(s):\n- ${found.join("\n- ")}`);
    process.exit(1);
  }
  console.log("every grammar tag has one meaning and every meaning one tag");
}

module.exports = { build, conflicts, definitions, meaningOf, undefinedInExamples };
