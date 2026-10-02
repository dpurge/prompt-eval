// promptfoo javascript assertion shared by the generate/ suites; the test's
// vars.kind selects the checks (see lib/generate-checks.js).
const { checkGenerate } = require("./generate-checks");

module.exports = async function (output, context) {
  return checkGenerate(context.vars.kind, output, context.vars);
};
