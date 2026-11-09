const Otp = require("../models/Otp");

async function create(data) {
  return Otp.create(data);
}

async function findLatestForUser(userId) {
  return Otp.findOne({ user: userId }).sort({ createdAt: -1 });
}

async function incrementAttempts(record) {
  record.attempts = (record.attempts || 0) + 1;
  return record.save();
}

async function deleteForUser(userId) {
  return Otp.deleteMany({ user: userId });
}

module.exports = {
  create,
  findLatestForUser,
  incrementAttempts,
  deleteForUser,
};
