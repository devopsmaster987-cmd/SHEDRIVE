const AdminReviewQueue = require("../models/AdminReviewQueue");

async function create(data) {
  return AdminReviewQueue.create(data);
}

async function deleteByUser(userId) {
  return AdminReviewQueue.deleteOne({ user: userId });
}

async function list({ status = "pending", page = 1, limit = 20 }) {
  const filter = status && status !== "all" ? { status } : {};
  const skip = (page - 1) * limit;

  const [items, total] = await Promise.all([
    AdminReviewQueue.find(filter)
      .populate("user", "name email phone role verificationStatus createdAt")
      .sort({ createdAt: 1 })
      .skip(skip)
      .limit(limit)
      .lean(),
    AdminReviewQueue.countDocuments(filter),
  ]);

  return { items, total };
}

async function findById(id) {
  return AdminReviewQueue.findById(id);
}

async function update(record, updates) {
  Object.assign(record, updates);
  return record.save();
}

async function findByUser(userId) {
  return AdminReviewQueue.findOne({ user: userId });
}

module.exports = { create, deleteByUser, list, findById, update, findByUser };
