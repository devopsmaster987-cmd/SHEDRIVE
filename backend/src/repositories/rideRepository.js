const Ride = require("../models/Ride");

const ACTIVE_STATUSES = ["searching", "accepted", "arriving", "in_progress"];

function populateRide(query) {
  return query.populate("rider", "name").populate("driver", "name");
}

async function create(data) {
  return Ride.create(data);
}

async function findById(id) {
  return populateRide(Ride.findById(id));
}

async function findRawById(id) {
  return Ride.findById(id);
}

async function findActiveForRider(userId) {
  return populateRide(
    Ride.findOne({ rider: userId, status: { $in: ACTIVE_STATUSES } }).sort({ createdAt: -1 })
  );
}

async function findActiveForDriver(userId) {
  return populateRide(
    Ride.findOne({ driver: userId, status: { $in: ACTIVE_STATUSES } }).sort({ createdAt: -1 })
  );
}

async function findActiveForUser(userId) {
  return populateRide(
    Ride.findOne({
      $or: [{ rider: userId }, { driver: userId }],
      status: { $in: ACTIVE_STATUSES },
    }).sort({ createdAt: -1 })
  );
}

async function updateById(id, updates, { filter = {} } = {}) {
  return populateRide(
    Ride.findOneAndUpdate({ _id: id, ...filter }, updates, {
      new: true,
      runValidators: true,
    })
  );
}

async function assignDriver(id, { driver, finalPrice, offerId, acceptedAt }) {
  return populateRide(
    Ride.findOneAndUpdate(
      { _id: id, status: "searching", driver: null },
      {
        $set: {
          driver,
          finalPrice,
          acceptedOffer: offerId,
          status: "accepted",
          acceptedAt,
        },
      },
      { new: true, runValidators: true }
    )
  );
}

async function listForUser(userId, { limit = 20 } = {}) {
  return populateRide(
    Ride.find({ $or: [{ rider: userId }, { driver: userId }] })
      .sort({ createdAt: -1 })
      .limit(limit)
  );
}

async function findNearbySearching({ lat, lng, maxDistanceMeters, vehicleType, since }) {
  return Ride.aggregate([
    {
      $geoNear: {
        near: { type: "Point", coordinates: [lng, lat] },
        distanceField: "pickupDistanceMeters",
        maxDistance: maxDistanceMeters,
        spherical: true,
        query: {
          status: "searching",
          vehicleType,
          createdAt: { $gte: since },
        },
      },
    },
    {
      $lookup: {
        from: "users",
        localField: "rider",
        foreignField: "_id",
        as: "riderAccount",
      },
    },
    { $unwind: "$riderAccount" },
    {
      $addFields: {
        riderName: "$riderAccount.name",
      },
    },
    { $project: { riderAccount: 0 } },
    { $sort: { createdAt: -1 } },
    { $limit: 20 },
  ]);
}

module.exports = {
  ACTIVE_STATUSES,
  create,
  findById,
  findRawById,
  findActiveForRider,
  findActiveForDriver,
  findActiveForUser,
  updateById,
  assignDriver,
  listForUser,
  findNearbySearching,
};
