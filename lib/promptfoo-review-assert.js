// promptfoo javascript assertion of the review-vocabulary suite.
const { scoreReview } = require("./review-vocabulary");

module.exports = async function (output, context) {
  return scoreReview(output, context.vars);
};
