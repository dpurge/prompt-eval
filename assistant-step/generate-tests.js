const path = require("path");
const { buildTests } = require("../lib/prompt-cases");

// One test per case in cases.yaml. SMOKE=1 runs the first case only,
// CASES=intake-empty,assess-last-answer selects cases by id.
module.exports = async function () {
  return buildTests({
    app: "assistant",
    casesFile: path.join(__dirname, "cases.yaml"),
    schemasDir: path.join(__dirname, "schemas"),
  });
};
