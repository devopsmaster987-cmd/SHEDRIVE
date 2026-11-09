const User = require("../models/User");

async function exists({ email, phone }) {
  const [emailFound, phoneFound] = await Promise.all([
    User.exists({ email: email.toLowerCase() }),
    User.exists({ phone }),
  ]);

  return { email: Boolean(emailFound), phone: Boolean(phoneFound) };
}

async function create(data) {
  return User.create(data);
}

async function findByEmail(email, { withPassword = false } = {}) {
  let query = User.findOne({ email: email.toLowerCase() });
  if (withPassword) query = query.select("+passwordHash");
  return query;
}

async function findById(id) {
  return User.findById(id);
}

async function updateById(id, updates) {
  return User.findByIdAndUpdate(id, updates, { new: true, runValidators: true });
}

async function deleteById(id) {
  return User.findByIdAndDelete(id);
}

async function addWalletBalance(id, amount) {
  return User.findByIdAndUpdate(
    id,
    { $inc: { walletBalance: amount } },
    { new: true, runValidators: true }
  );
}

async function deductWalletBalance(id, amount) {
  // The balance check is part of the update filter so two payments cannot
  // spend the same money at the same time.
  return User.findOneAndUpdate(
    { _id: id, walletBalance: { $gte: amount } },
    { $inc: { walletBalance: -amount } },
    { new: true, runValidators: true }
  );
}

async function findAdminIds() {
  return User.find({ role: "admin", isBanned: false }).distinct("_id");
}

module.exports = {
  exists,
  create,
  findByEmail,
  findById,
  updateById,
  deleteById,
  addWalletBalance,
  deductWalletBalance,
  findAdminIds,
};
