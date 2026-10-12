// Mirrors phraseforge's review call (phraseforge/internal/ai/review.go): how an
// entry is laid out for the prompt and how a reply is read.

const orNone = (s) => (String(s ?? "").trim() === "" ? "none" : s);

// formatExamples mirrors ai.formatReviewExamples: numbered from 1.
function formatExamples(examples) {
  return orNone((examples ?? []).map((e, i) => `${i + 1}. ${e}`).join("\n"));
}

// formatTranslations mirrors ai.formatReviewTranslations: "- locale: text" per
// locale, a "  notes:" line below when there are notes, English first, then
// locale-code order.
function formatTranslations(translations) {
  const order = (l) => (l === "en" ? "" : l);
  const sorted = [...(translations ?? [])].sort((a, b) => order(a.locale).localeCompare(order(b.locale)));
  const text = sorted
    .map((t) => `- ${t.locale}: ${orNone(t.translation)}\n` + (String(t.notes ?? "").trim() ? `  notes: ${t.notes}\n` : ""))
    .join("")
    .replace(/\n+$/, "");
  return orNone(text);
}

// flaggedFields returns the checks of a reply that report something: phrase,
// grammar and transcription when not ok or with a suggestion; translations,
// notes and examples when any of their entries is, or (examples) is not "keep".
// { error } when the reply is not a JSON object with a phrase entry.
function flaggedFields(output) {
  let reply;
  try {
    reply = JSON.parse(String(output).trim());
  } catch (err) {
    return { error: `the reply is not a JSON object: ${err.message}` };
  }
  if (reply === null || typeof reply !== "object" || Array.isArray(reply) || !reply.phrase) {
    return { error: 'the reply has no "phrase" entry' };
  }
  const raised = (e) => !!e && typeof e === "object" && (e.ok === false || String(e.suggestion ?? "").trim() !== "");
  const flagged = new Set();
  for (const field of ["phrase", "grammar", "transcription"]) if (raised(reply[field])) flagged.add(field);
  for (const field of ["translations", "notes"]) if ((reply[field] ?? []).some(raised)) flagged.add(field);
  if ((reply.examples ?? []).some((e) => e && e.action && e.action !== "keep")) flagged.add("examples");
  return { flagged };
}

// scoreReview: every expected check is raised, and none of phrase, grammar,
// transcription and translations is raised unexpectedly (notes and examples are
// matters of taste and only count when expected).
function scoreReview(output, vars) {
  const result = flaggedFields(output);
  if (result.error) return { pass: false, score: 0, reason: result.error };
  const expected = new Set(JSON.parse(vars.expectedFlags));
  const missing = [...expected].filter((f) => !result.flagged.has(f));
  const unexpected = ["phrase", "grammar", "transcription", "translations"].filter((f) => result.flagged.has(f) && !expected.has(f));
  const wrong = missing.length + unexpected.length;
  return {
    pass: wrong === 0,
    score: wrong === 0 ? 1 : 0,
    reason: wrong === 0 ? "flags as expected" : `missing: [${missing}] unexpected: [${unexpected}]`,
  };
}

module.exports = { formatExamples, formatTranslations, flaggedFields, scoreReview };
