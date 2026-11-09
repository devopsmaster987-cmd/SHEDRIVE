const RideOffer = require("../models/RideOffer");

async function upsertPending(data) {
  const { ride, driver, ...updates } = data;
  return RideOffer.findOneAndUpdate(
    { ride, driver, status: "pending" },
    {
      $set: {
        ...updates,
        ride,
        driver,
        status: "pending",
        respondedAt: null,
      },
    },
    {
      upsert: true,
      new: true,
      runValidators: true,
      setDefaultsOnInsert: true,
    }
  );
}

async function findById(id) {
  return RideOffer.findById(id);
}

async function findPendingForRide(rideId) {
  return RideOffer.find({ ride: rideId, status: "pending" }).sort({
    offerPrice: 1,
    createdAt: 1,
  });
}

async function findPendingForDriver(rideId, driverId) {
  return RideOffer.findOne({ ride: rideId, driver: driverId, status: "pending" });
}

async function expireStale(rideId, now = new Date()) {
  return RideOffer.updateMany(
    { ride: rideId, status: "pending", expiresAt: { $lte: now } },
    { $set: { status: "expired", respondedAt: now } }
  );
}

async function markAccepted(id, acceptedAt = new Date()) {
  return RideOffer.findOneAndUpdate(
    { _id: id, status: "pending" },
    { $set: { status: "accepted", respondedAt: acceptedAt } },
    { new: true }
  );
}

async function rejectOthers(rideId, acceptedOfferId, respondedAt = new Date()) {
  return RideOffer.updateMany(
    { ride: rideId, _id: { $ne: acceptedOfferId }, status: "pending" },
    { $set: { status: "rejected", respondedAt } }
  );
}

async function rejectForRide(rideId, respondedAt = new Date()) {
  return RideOffer.updateMany(
    { ride: rideId, status: "pending" },
    { $set: { status: "rejected", respondedAt } }
  );
}

module.exports = {
  upsertPending,
  findById,
  findPendingForRide,
  findPendingForDriver,
  expireStale,
  markAccepted,
  rejectOthers,
  rejectForRide,
};
