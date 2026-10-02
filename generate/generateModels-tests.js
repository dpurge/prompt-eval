const { generateTests } = require("../lib/tests");

module.exports = async function () {
  return generateTests("generateModels");
};
