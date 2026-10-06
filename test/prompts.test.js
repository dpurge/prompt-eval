const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { createPrompts } = require("../lib/prompts");

// A throwaway prompt/ tree: default title prompt and snippets, German with
// its own grammar snippet, Arabic overriding the title prompt, Chinese with
// a CRLF transcription snippet.
function fixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "prompts-"));
  const put = (file, text) => {
    fs.mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
    fs.writeFileSync(path.join(dir, file), text);
  };
  put("default/system/title.txt", "Default title\n");
  put("default/system/item.txt", "G={{grammarPrompt}} T={{transcriptionPrompt}} {{phrase}} {{sourceLanguage}}>{{targetLanguage}}\n");
  put("default/snippet/grammar.txt", "default grammar\n");
  put("default/snippet/transcription.txt", "default transcription\n");
  put("lang/deu/snippet/grammar.txt", "deu grammar\n");
  put("lang/arb/system/title.txt", "Arabic title\n");
  put("lang/cmn/snippet/transcription.txt", "pinyin\r\nrules\r\n");
  return { dir, prompts: createPrompts(dir) };
}

test("a language without its own system prompt gets the default, byte for byte", () => {
  const { prompts } = fixture();
  assert.equal(prompts.systemPrompt("title", "deu"), "Default title\n");
  assert.equal(prompts.systemPrompt("title"), "Default title\n");
});

test("a language's own system prompt replaces the default", () => {
  const { prompts } = fixture();
  assert.equal(prompts.systemPrompt("title", "arb"), "Arabic title\n");
});

test("a missing default system prompt names the file it expected", () => {
  const { dir, prompts } = fixture();
  assert.throws(() => prompts.systemPrompt("nope", "deu"), new RegExp(`system prompt "nope" not found: expected ${path.join(dir, "default", "system", "nope.txt")}`));
});

test("a language's own snippet replaces the default", () => {
  const { prompts } = fixture();
  assert.equal(prompts.snippet("grammar", "deu", { useDefault: true }), "deu grammar\n");
  assert.equal(prompts.snippet("grammar", "deu"), "deu grammar\n");
});

test("without its own snippet a language gets the default only when it needs one", () => {
  const { prompts } = fixture();
  assert.equal(prompts.snippet("transcription", "deu", { useDefault: true }), "default transcription\n");
  assert.equal(prompts.snippet("transcription", "deu"), "");
});

test("snippets are read with LF line endings", () => {
  const { prompts } = fixture();
  assert.equal(prompts.snippet("transcription", "cmn"), "pinyin\nrules\n");
});

test("snippets returns the placeholder values of a language", () => {
  const { prompts } = fixture();
  assert.deepEqual(prompts.snippets("deu", { transcription: true }), { grammarPrompt: "deu grammar\n", transcriptionPrompt: "default transcription\n" });
  assert.deepEqual(prompts.snippets("deu"), { grammarPrompt: "deu grammar\n", transcriptionPrompt: "" });
});

test("renderPrompt fills the snippets and the item vars", () => {
  const { prompts } = fixture();
  const vars = { sourceLanguage: "German", targetLanguage: "Polish", phrase: "der Koffer" };
  assert.equal(prompts.renderPrompt("item", "deu", vars), "G=deu grammar\n T= der Koffer German>Polish\n");
});

test("renderPrompt never expands a placeholder inside a value", () => {
  const { prompts } = fixture();
  const out = prompts.renderPrompt("item", "deu", { sourceLanguage: "x", targetLanguage: "y", phrase: "{{grammarPrompt}}" });
  assert.match(out, / \{\{grammarPrompt\}\} x>y/);
});

test("an unknown snippet kind or an unsafe name is refused", () => {
  const { prompts } = fixture();
  assert.throws(() => prompts.snippet("tags", "deu"), /unknown snippet kind "tags"/);
  assert.throws(() => prompts.systemPrompt("../secret", "deu"), /invalid prompt name/);
  assert.throws(() => prompts.systemPrompt("title", "../deu"), /invalid language/);
});

test("the real prompt/ tree resolves every default and language file", () => {
  const real = require("../lib/prompts");
  const root = path.join(__dirname, "..", "prompt");
  for (const file of fs.readdirSync(path.join(root, "default", "system"))) {
    assert.ok(real.systemPrompt(path.basename(file, ".txt")).length > 0, file);
  }
  for (const lang of fs.readdirSync(path.join(root, "lang"))) {
    for (const kind of ["grammar", "transcription"]) {
      const exists = fs.existsSync(path.join(root, "lang", lang, "snippet", `${kind}.txt`));
      assert.equal(real.snippet(kind, lang).length > 0, exists, `${lang}/${kind}`);
    }
  }
});
