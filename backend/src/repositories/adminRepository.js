const User = require("../models/User");
const DriverDetails = require("../models/DriverDetails");
const Ride = require("../models/Ride");
const Payment = require("../models/Payment");
const SOSAlert = require("../models/SOSAlert");
const AdminReviewQueue = require("../models/AdminReviewQueue");

function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function stats() {
  const [
    users,
    riders,
    drivers,
    bannedUsers,
    onlineDrivers,
    rides,
    activeRides,
    completedRides,
    cancelledRides,
    openSos,
    pendingReviews,
    pendingDocs,
    revenueRows,
  ] = await Promise.all([
    User.countDocuments({}),
    User.countDocuments({ role: "rider" }),
    User.countDocuments({ role: "driver" }),
    User.countDocuments({ isBanned: true }),
    DriverDetails.countDocuments({ isOnline: true }),
    Ride.countDocuments({}),
    Ride.countDocuments({
      status: { $in: ["searching", "accepted", "arriving", "in_progress"] },
    }),
    Ride.countDocuments({ status: "completed" }),
    Ride.countDocuments({ status: "cancelled" }),
    SOSAlert.countDocuments({ status: "open" }),
    AdminReviewQueue.countDocuments({ status: "pending" }),
    DriverDetails.countDocuments({ licenseDocStatus: "pending" }),
    Payment.aggregate([
      { $match: { status: "paid" } },
      { $group: { _id: null, total: { $sum: "$amount" } } },
    ]),
  ]);

  return {
    users,
    riders,
    drivers,
    bannedUsers,
    onlineDrivers,
    rides,
    activeRides,
    completedRides,
    cancelledRides,
    openSos,
    pendingReviews,
    pendingDocs,
    revenue: Number(revenueRows[0]?.total) || 0,
    currency: "INR",
  };
}

async function listUsers({ role = "all", status = "all", search = "", page = 1, limit = 20 } = {}) {
  const filter = {};
  if (role && role !== "all") filter.role = role;
  if (status === "banned") filter.isBanned = true;
  else if (status === "active") filter.isBanned = false;
  else if (status && status !== "all") filter.verificationStatus = status;

  if (search) {
    const pattern = new RegExp(escapeRegex(search), "i");
    filter.$or = [{ name: pattern }, { email: pattern }, { phone: pattern }];
  }

  const skip = (page - 1) * limit;
  const [items, total] = await Promise.all([
    User.aggregate([
      { $match: filter },
      {
        $lookup: {
          from: "driverdetails",
          localField: "_id",
          foreignField: "user",
          as: "driverProfile",
        },
      },
      {
        $project: {
          name: 1,
          email: 1,
          phone: 1,
          role: 1,
          verificationStatus: 1,
          phoneVerified: 1,
          walletBalance: 1,
          isBanned: 1,
          moderationReason: 1,
          createdAt: 1,
          driver: { $ifNull: [{ $arrayElemAt: ["$driverProfile", 0] }, null] },
        },
      },
      { $sort: { createdAt: -1 } },
      { $skip: skip },
      { $limit: limit },
    ]),
    User.countDocuments(filter),
  ]);

  return { items, total };
}

async function listDriverDocs({ status = "pending", page = 1, limit = 20 } = {}) {
  const filter = status && status !== "all" ? { licenseDocStatus: status } : {};
  const skip = (page - 1) * limit;

  const [items, total] = await Promise.all([
    DriverDetails.find(filter)
      .populate("user", "name email phone role verificationStatus isBanned")
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean(),
    DriverDetails.countDocuments(filter),
  ]);

  return { items, total };
}

async function findDriverDocById(id) {
  return DriverDetails.findById(id).populate(
    "user",
    "name email phone role verificationStatus isBanned"
  );
}

async function updateDriverDoc(id, updates) {
  return DriverDetails.findByIdAndUpdate(
    id,
    { $set: updates },
    { new: true, runValidators: true }
  ).populate("user", "name email phone role verificationStatus isBanned");
}

async function setDriverOffline(userId) {
  return DriverDetails.findOneAndUpdate(
    { user: userId },
    { $set: { isOnline: false, activeRide: null } },
    { new: true, runValidators: true }
  );
}

async function recentRides(limit = 8) {
  return Ride.find({})
    .populate("rider", "name")
    .populate("driver", "name")
    .sort({ createdAt: -1 })
    .limit(limit)
    .lean();
}

module.exports = {
  stats,
  listUsers,
  listDriverDocs,
  findDriverDocById,
  updateDriverDoc,
  setDriverOffline,
  recentRides,
};
