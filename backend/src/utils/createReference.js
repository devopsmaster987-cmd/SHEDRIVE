const { randomUUID } = require("node:crypto");

function createReference(prefix) {
  const time = Date.now().toString(36).toUpperCase();
  const random = randomUUID().slice(0, 8).toUpperCase();
  return `${prefix}-${time}-${random}`;
}

module.exports = createReference;
