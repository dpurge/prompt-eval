// Resolves prompt text from the prompt/ directory, the one place prompt files
// live:
//
//   prompt/default/system/<name>.txt         default system prompts
//   prompt/default/snippet/<kind>.txt        default grammar / transcription snippets
//   prompt/lang/<lang>/system/<name>.txt     per-language replacement of a system prompt
//   prompt/lang/<lang>/snippet/<kind>.txt    per-language replacement of a snippet
//
// A language file, when present, wins over the default of the same name.
const fs = require("fs");
const path = require("path");
const { renderItemPrompt } = require("./correction");

const PROMPT_DIR = path.join(__dirname, "..", "prompt");
const SNIPPET_KINDS = ["grammar", "transcription"];
// Names become path segments; refuse anything that could leave prompt/.
const SAFE_SEGMENT = /^[A-Za-z][A-Za-z0-9-]*$/;

function checkSegment(label, value) {
  if (typeof value !== "string" || !SAFE_SEGMENT.test(value)) {
    throw new Error(`invalid ${label} ${JSON.stringify(value)}: expected letters, digits and "-" only`);
  }
}

function createPrompts(dir = PROMPT_DIR) {
  const read = (file) => (fs.existsSync(file) ? fs.readFileSync(file, "utf8") : null);

  // systemPrompt returns the language's own prompt when it has one, else the
  // default. The text is returned byte for byte: promptfoo and phraseforge
  // send it exactly as stored.
  function systemPrompt(name, language) {
    checkSegment("prompt name", name);
    if (language) checkSegment("language", language);
    const own = language ? read(path.join(dir, "lang", language, "system", `${name}.txt`)) : null;
    if (own !== null) return own;
    const file = path.join(dir, "default", "system", `${name}.txt`);
    const fallback = read(file);
    if (fallback === null) throw new Error(`system prompt "${name}" not found: expected ${file}`);
    return fallback;
  }

  // snippet returns the language's own snippet, with LF line endings as
  // phraseforge stores sections. Without one it is the default snippet when
  // useDefault is true (the language needs the section), else "" — which is
  // how phraseforge renders a language without a section.
  function snippet(kind, language, { useDefault = false } = {}) {
    if (!SNIPPET_KINDS.includes(kind)) throw new Error(`unknown snippet kind ${JSON.stringify(kind)}: expected one of ${SNIPPET_KINDS.join(", ")}`);
    checkSegment("language", language);
    let text = read(path.join(dir, "lang", language, "snippet", `${kind}.txt`));
    if (text === null && useDefault) {
      const file = path.join(dir, "default", "snippet", `${kind}.txt`);
      text = read(file);
      if (text === null) throw new Error(`default ${kind} snippet not found: expected ${file}`);
    }
    return text === null ? "" : text.replace(/\r\n/g, "\n");
  }

  // snippets returns the {{grammarPrompt}} / {{transcriptionPrompt}} values of
  // a language; useDefault names the kinds that fall back to the default.
  function snippets(language, useDefault = {}) {
    return {
      grammarPrompt: snippet("grammar", language, { useDefault: !!useDefault.grammar }),
      transcriptionPrompt: snippet("transcription", language, { useDefault: !!useDefault.transcription }),
    };
  }

  // renderPrompt is the system prompt of name for language with the snippet
  // placeholders and the item vars (sourceLanguage, targetLanguage, phrase)
  // substituted in one pass.
  function renderPrompt(name, language, vars = {}, useDefault = {}) {
    return renderItemPrompt(systemPrompt(name, language), { ...vars, ...snippets(language, useDefault) });
  }

  return { systemPrompt, snippet, snippets, renderPrompt };
}

module.exports = { createPrompts, ...createPrompts() };
