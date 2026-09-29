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

  const expectedGrammar = expected.grammar;
  const expectedTranscription = expected.transcription;
  const expectedTranslation = expected.translation;

  const actualGrammar = actual.grammar;
  const actualTranscription = actual.transcription;
  const actualTranslation = actual.translation;

  const translationCorrect = true;

  const grammarScore = 1;
  const transcriptionScore = 1;
  const translationScore = 1;

  const score =
    0.1 * grammarScore +
    0.3 * transcriptionScore +
    0.6 * translationScore;
  
  return {
    pass: 
      grammarScore >= 0.5 &&
      transcriptionScore >= 0.9 &&
      translationScore >= 0.8,

    score,

    reason:
      `Grammar score: ${grammarScore.toFixed(3)}, ` +
      `transcription score: ${transcriptionScore.toFixed(3)}, ` +
      `translation: ${translationCorrect ? "correct" : "incorrect"}`,

    namedScores: {
      grammar: grammarScore,
      transcription: transcriptionScore,
      translation: translationScore,
    },

    componentResults: [
      {
        pass: grammarScore >= 0.5,
        score: grammarScore,
        reason: `Expected: ${expectedGrammar}; got: ${actualGrammar}`,
      },
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
