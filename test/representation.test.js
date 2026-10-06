// The eval's own texts (language snippet files, item data, generate datasets) use the
// standard way of representing each script, so a reference never differs from
// a correct model reply only by how a character is encoded:
//   - Unicode NFC;
//   - no Arabic or Hebrew presentation forms (U+FB1D-FB4F, U+FB50-FDFF,
//     U+FE70-FEFF): letters are written as plain letters plus marks;
//   - Yiddish: the digraph letters U+05F0-05F2 only as the pasekh form
//     (U+05F2 U+05B7, "ay"); "ey" is two plain yuds;
//   - Romanian: comma-below ș ț (U+0219, U+021B), never the cedilla forms
//     (U+015F, U+0163), which are the correct letters for Turkish only.
// phrase-robustness.yaml is left out on purpose: it holds unnormalized text to
// test how the prompts cope with it.
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const SCANNED = [
  ...fs.readdirSync(path.join(root, "prompt", "lang")).map((lang) => ({ dir: `prompt/lang/${lang}/snippet`, ext: ".txt" })),
  { dir: "vocabulary-translation/data", ext: ".yaml" },
  { dir: "models-item/data", ext: ".yaml" },
  { dir: "datasets", ext: ".yaml", only: /^generate-/ },
];

function files() {
  return SCANNED.flatMap(({ dir, ext, only }) =>
    fs.readdirSync(path.join(root, dir))
      .filter((f) => f.endsWith(ext) && (!only || only.test(f)))
      .map((f) => path.join(dir, f)));
}

const PRESENTATION = /[יִ-ﭏﭐ-﷿ﹰ-﻿]/u;
const YIDDISH_LIGATURE_WITHOUT_PASEKH = /[װױ]|ײ(?!ַ)/u;
const ROMANIAN_CEDILLA = /[ŞşŢţ]/u;

function problems(file, text) {
  const found = [];
  if (text.normalize("NFC") !== text) found.push("is not NFC-normalized");
  const presentation = text.match(PRESENTATION);
  if (presentation) found.push(`has the presentation form U+${presentation[0].codePointAt(0).toString(16).toUpperCase()}`);
  if (YIDDISH_LIGATURE_WITHOUT_PASEKH.test(text)) found.push("has a Yiddish digraph ligature other than the pasekh form");
  if (/(^|[/\\-])ron[-./\\]/.test(file)) {
    if (ROMANIAN_CEDILLA.test(text)) found.push("uses cedilla ş/ţ; Romanian takes comma-below ș/ț");
  }
  return found;
}

test("the eval's texts use the standard representation of each script", () => {
  const bad = files().flatMap((file) => problems(file, fs.readFileSync(path.join(root, file), "utf8")).map((p) => `${file} ${p}`));
  assert.deepStrictEqual(bad, []);
});

test("the checks themselves catch each kind of non-standard text", () => {
  assert.deepStrictEqual(problems("x.txt", "é"), ["is not NFC-normalized"]);
  assert.match(problems("x.txt", "ﻻ")[0], /presentation form U\+FEFB/);
  assert.match(problems("x.txt", "ײ")[0], /Yiddish digraph/);
  assert.deepStrictEqual(problems("x.txt", "ײַ"), []);
  assert.match(problems("ron-grammar.txt", "ş")[0], /cedilla/);
  assert.deepStrictEqual(problems("tur-grammar.txt", "ş"), []);
  assert.deepStrictEqual(problems("ron-grammar.txt", "ș ț"), []);
  assert.match(problems("prompt/lang/ron/snippet/grammar.txt", "ş")[0], /cedilla/);
  assert.deepStrictEqual(problems("prompt/lang/tur/snippet/grammar.txt", "ş"), []);
});
