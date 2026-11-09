const Notification = require("../models/Notification");

async function create(data) {
  return Notification.create(data);
}

async function createMany(entries) {
  if (!entries?.length) return [];
  return Notification.insertMany(entries, { ordered: false });
}

async function listForUser(userId, { limit = 20 } = {}) {
  return Notification.find({ user: userId }).sort({ createdAt: -1 }).limit(limit).lean();
}

async function countUnread(userId) {
  return Notification.countDocuments({ user: userId, readStatus: false });
}

async function markRead(id, userId) {
  return Notification.findOneAndUpdate(
    { _id: id, user: userId },
    { $set: { readStatus: true, readAt: new Date() } },
    { new: true, runValidators: true }
  );
}

async function markAllRead(userId) {
  return Notification.updateMany(
    { user: userId, readStatus: false },
    { $set: { readStatus: true, readAt: new Date() } }
  );
}

module.exports = { create, createMany, listForUser, countUnread, markRead, markAllRead };
