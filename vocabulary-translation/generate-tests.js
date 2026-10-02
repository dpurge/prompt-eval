const path = require("path");
const { referenceTests, structureTests } = require("../lib/tests");

// Reference rows (graded against expected translation/grammar/transcription)
// plus the structure-only phrase-robustness rows.
module.exports = async function () {
  return [
    ...referenceTests(path.join(__dirname, "data")),
    ...structureTests(path.join(__dirname, "..", "datasets", "phrase-robustness.yaml"), { grammar: true }),
  ];
};
