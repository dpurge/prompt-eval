// Mirrors phraseforge's check call (phraseforge/internal/ai/check.go): how the
// candidates are laid out for {{candidates}} and how the reply is read.

// formatCandidates mirrors ai.formatCheckItems: numbered from 1, each with its
// usage, examples and translations (by locale code, in code order), "none"
// where there are none, values joined with " | ".
function formatCandidates(items) {
  return items
    .map((item, i) => {
      const examples = item.examples?.length ? item.examples.join(" | ") : "none";
      const locales = Object.keys(item.translations ?? {}).sort();
      const translations = locales.length ? locales.map((l) => `${l}: ${item.translations[l]}`).join(" | ") : "none";
      return `${i + 1}. ${item.phrase}\n   usage: ${item.usage}\n   examples: ${examples}\n   translations: ${translations}\n`;
    })
    .join("");
}

// renderCheckPrompt mirrors ai.renderCheckPrompt: one pass, so text inside a
// value is never expanded again.
function renderCheckPrompt(template, vars) {
  const values = { sourceLanguage: vars.sourceLanguage, candidates: vars.candidates };
  return template.replace(/\{\{(sourceLanguage|candidates)\}\}/g, (_, name) => values[name]);
}

// parseVerdicts mirrors ai.parseCheckVerdicts: the reply must be a JSON object
// with a results array (otherwise { error }); inside it an entry that is not an
// object with an integer n in 1..count and a boolean needsExample is ignored; a
// needsSense that is absent or not a boolean counts as false. Returns
// { verdicts: Map of 0-based index -> { needsExample, needsSense } } with the
// items that need something.
function parseVerdicts(output, count) {
  let reply;
  try {
    reply = JSON.parse(String(output).trim());
  } catch (err) {
    return { error: `the reply is not a JSON object: ${err.message}` };
  }
  if (reply === null || typeof reply !== "object" || Array.isArray(reply) || !Array.isArray(reply.results)) {
    return { error: 'the reply has no "results" array' };
  }
  const verdicts = new Map();
  for (const entry of reply.results) {
    if (entry === null || typeof entry !== "object" || !Number.isInteger(entry.n) || typeof entry.needsExample !== "boolean") continue;
    if (entry.n < 1 || entry.n > count) continue;
    const needsSense = entry.needsSense === true;
    if (entry.needsExample || needsSense) verdicts.set(entry.n - 1, { needsExample: entry.needsExample, needsSense });
  }
  return { verdicts };
}

// scoreCheck grades a reply against vars.expected (a JSON array of
// { example, sense } booleans, one per candidate): score is the share of
// candidates with both verdicts right (a candidate missing from the reply
// counts as no/no, as phraseforge treats it); an unparseable reply scores 0.
// It passes only when every verdict is right.
function scoreCheck(output, vars) {
  const expected = JSON.parse(vars.expected);
  const parsed = parseVerdicts(output, expected.length);
  if (parsed.error) return { pass: false, score: 0, reason: parsed.error };
  const problems = [];
  expected.forEach((want, i) => {
    const got = parsed.verdicts.get(i) ?? { needsExample: false, needsSense: false };
    if (got.needsExample !== want.example) problems.push(`candidate ${i + 1}: needsExample ${got.needsExample}, expected ${want.example}`);
    if (got.needsSense !== want.sense) problems.push(`candidate ${i + 1}: needsSense ${got.needsSense}, expected ${want.sense}`);
  });
  const wrongCandidates = new Set(problems.map((p) => p.split(":")[0])).size;
  return {
    pass: problems.length === 0,
    score: (expected.length - wrongCandidates) / expected.length,
    reason: problems.length === 0 ? "every verdict as expected" : problems.join("; "),
  };
}

module.exports = { formatCandidates, renderCheckPrompt, parseVerdicts, scoreCheck };
