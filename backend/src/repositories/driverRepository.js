const DriverDetails = require("../models/DriverDetails");
const Ride = require("../models/Ride");

async function create(data) {
  return DriverDetails.create(data);
}

async function deleteByUser(userId) {
  return DriverDetails.deleteOne({ user: userId });
}

async function findByUser(userId) {
  return DriverDetails.findOne({ user: userId });
}

async function updateByUser(userId, updates) {
  return DriverDetails.findOneAndUpdate({ user: userId }, updates, {
    new: true,
    runValidators: true,
  });
}

async function findNearby({ lat, lng, maxDistanceMeters, vehicleType = null }) {
  const match = { isOnline: true, activeRide: null };
  if (vehicleType) match.vehicleType = vehicleType;

  return DriverDetails.aggregate([
    {
      $geoNear: {
        near: { type: "Point", coordinates: [lng, lat] },
        distanceField: "distanceMeters",
        maxDistance: maxDistanceMeters,
        spherical: true,
        query: match,
      },
    },
    {
      $lookup: {
        from: "users",
        localField: "user",
        foreignField: "_id",
        as: "account",
      },
    },
    { $unwind: "$account" },
    {
      $match: {
        "account.verificationStatus": "approved",
        "account.isBanned": false,
      },
    },
    {
      $project: {
        user: 1,
        vehicleType: 1,
        ratingAvg: 1,
        currentLocation: 1,
        distanceMeters: 1,
      },
    },
    { $limit: 12 },
  ]);
}

async function countOnline() {
  return DriverDetails.countDocuments({ isOnline: true });
}

async function completedRides(userId) {
  return Ride.find({ driver: userId, status: "completed" })
    .select("finalPrice offeredPrice completedAt createdAt")
    .lean();
}

module.exports = {
  create,
  deleteByUser,
  findByUser,
  updateByUser,
  findNearby,
  countOnline,
  completedRides,
};
