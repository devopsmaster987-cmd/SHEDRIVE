const WalletTransaction = require("../models/WalletTransaction");

async function create(data) {
  return WalletTransaction.create(data);
}

async function listForUser(userId, { limit = 25 } = {}) {
  return WalletTransaction.find({ user: userId }).sort({ createdAt: -1 }).limit(limit);
}

module.exports = { create, listForUser };
