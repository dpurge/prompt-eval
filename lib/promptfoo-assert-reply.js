// promptfoo javascript assertion: scores the model's reply against the case
// carried in the test's vars (schema and expect, as JSON text), see
// lib/assert-reply.js.
const { assertReply } = require("./assert-reply");

module.exports = async function (output, context) {
  const { schema, expect } = context.vars;
  return assertReply(output, {
    schema: typeof schema === "string" ? JSON.parse(schema) : schema,
    expect: typeof expect === "string" ? JSON.parse(expect) : expect,
  });
};
