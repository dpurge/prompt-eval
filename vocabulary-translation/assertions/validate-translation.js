function normalize(text) {
  return text
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[.,!?;:'"„“”()]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function levenshtein(a, b) {
  const matrix = Array.from(
    { length: a.length + 1 },
    () => Array(b.length + 1).fill(0)
  );

  for (let i = 0; i <= a.length; i++) matrix[i][0] = i;
  for (let j = 0; j <= b.length; j++) matrix[0][j] = j;

  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      matrix[i][j] =
        a[i - 1] === b[j - 1]
          ? matrix[i - 1][j - 1]
          : Math.min(
              matrix[i - 1][j] + 1,
              matrix[i][j - 1] + 1,
              matrix[i - 1][j - 1] + 1
            );
    }
  }

  return matrix[a.length][b.length];
}

module.exports = async function(output, context) {
  let actual;

  try {
    actual = JSON.parse(output);
  } catch {
    return {
      pass: false,
      score: 0,
      reason: "Model output is not valid JSON",
    };
  }

  const expected = context.vars;

  const expectedTranscription = expected.transcription;
  const expectedTranslation = expected.translation;

  const actualTranscription = actual.transcription;
  const actualTranslation = actual.translation;

  if (!actualTranscription || !actualTranslation) {
    return {
      pass: false,
      score: 0,
      reason: "Missing transcription or translation",
    };
  }

  // Transcription validation
  const reference = normalize(expectedTranscription);
  const hypothesis = normalize(actualTranscription);

  const distance = levenshtein(reference, hypothesis);
  const transcriptionScore = 1 - distance / Math.max(reference.length, hypothesis.length, 1);

  // Translation validation
  const translationCorrect = normalize(actualTranslation) === normalize(expectedTranslation);

  const translationScore = translationCorrect ? 1 : 0;

  const score =
    0.4 * transcriptionScore +
    0.6 * translationScore;

  return {
    pass:
      transcriptionScore >= 0.9 &&
      translationScore >= 1,

    score,

    reason:
      `Transcription score: ${transcriptionScore.toFixed(3)}, ` +
      `translation: ${translationCorrect ? "correct" : "incorrect"}`,

    namedScores: {
      transcription: transcriptionScore,
      translation: translationScore,
    },

    componentResults: [
      {
        pass: transcriptionScore >= 0.9,
        score: transcriptionScore,
        reason: `Expected: ${expectedTranscription}; got: ${actualTranscription}`,
      },
      {
        pass: translationCorrect,
        score: translationScore,
        reason: `Expected: ${expectedTranslation}; got: ${actualTranslation}`,
      },
    ],
  };
};
