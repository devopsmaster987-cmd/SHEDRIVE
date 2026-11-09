const SOSAlert = require("../models/SOSAlert");

function populateAlert(query) {
  return query
    .populate("user", "name email phone role verificationStatus")
    .populate("ride", "status pickupLabel dropLabel rider driver");
}

async function create(data) {
  return SOSAlert.create(data);
}

async function findById(id) {
  return populateAlert(SOSAlert.findById(id));
}

async function findOpenForUser(userId) {
  return populateAlert(
    SOSAlert.findOne({ user: userId, status: { $in: ["open", "acknowledged"] } }).sort({
      createdAt: -1,
    })
  );
}

async function list({ status = "open", page = 1, limit = 20 } = {}) {
  const filter = status && status !== "all" ? { status } : {};
  const skip = (page - 1) * limit;

  const [items, total] = await Promise.all([
    populateAlert(SOSAlert.find(filter).sort({ raisedAt: -1 }).skip(skip).limit(limit)),
    SOSAlert.countDocuments(filter),
  ]);

  return { items, total };
}

async function updateById(id, updates) {
  return populateAlert(
    SOSAlert.findByIdAndUpdate(id, { $set: updates }, { new: true, runValidators: true })
  );
}

async function countOpen() {
  return SOSAlert.countDocuments({ status: "open" });
}

module.exports = { create, findById, findOpenForUser, list, updateById, countOpen };
