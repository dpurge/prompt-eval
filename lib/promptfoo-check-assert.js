// promptfoo javascript assertion of the check-vocabulary suite.
const { scoreCheck } = require("./check-vocabulary");

module.exports = async function (output, context) {
  return scoreCheck(output, context.vars);
};
