const { correctionTests } = require("../lib/tests");

module.exports = async function () {
  return correctionTests("models");
};
