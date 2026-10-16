// promptfoo prompt function: one system message (vars.system, the rendered
// system prompt) and one user message (vars.input), the shape of a chat call.
module.exports = function ({ vars }) {
  return [
    { role: "system", content: vars.system },
    { role: "user", content: vars.input },
  ];
};
