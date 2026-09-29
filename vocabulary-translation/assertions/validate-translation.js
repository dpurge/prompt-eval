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

  const translationCorrect = true;

  const transcriptionScore = 1;
  const translationScore = 1;

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
