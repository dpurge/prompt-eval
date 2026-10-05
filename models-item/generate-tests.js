const path = require("path");
const { structureTests, referenceTests } = require("../lib/tests");

// Models items have no grammar section and no reference answers yet, so every
// row is structure-only: valid JSON, non-blank fields, phrase echoed back.
module.exports = async function () {
  const datasets = path.join(__dirname, "..", "datasets");
  return [
    ...referenceTests(path.join(__dirname, "data"), { grammar: false, itemKind: "models" }),
    ...structureTests(path.join(datasets, "model-patterns.yaml"), { grammar: false }),
    ...structureTests(path.join(datasets, "phrase-robustness.yaml"), { grammar: false }),
  ];
};
