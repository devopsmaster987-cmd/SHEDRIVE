const Rating = require("../models/Rating");

async function create(data) {
  return Rating.create(data);
}

async function findByRideAndRater(rideId, ratedById) {
  return Rating.findOne({ ride: rideId, ratedBy: ratedById });
}

async function averageForUser(userId) {
  const [result] = await Rating.aggregate([
    { $match: { ratedUser: userId } },
    { $group: { _id: "$ratedUser", average: { $avg: "$stars" }, count: { $sum: 1 } } },
  ]);

  return result ? { average: result.average, count: result.count } : { average: null, count: 0 };
}

module.exports = { create, findByRideAndRater, averageForUser };
