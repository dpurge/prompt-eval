// promptfoo javascript assertion shared by every item suite.
const { validateReply } = require("./validate-reply");

module.exports = async function (output, context) {
  return validateReply(output, context.vars);
};
