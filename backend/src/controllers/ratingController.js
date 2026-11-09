const AppError = require("../utils/AppError");
const serializeRating = require("../utils/serializeRating");
const rideRepository = require("../repositories/rideRepository");
const ratingRepository = require("../repositories/ratingRepository");
const driverRepository = require("../repositories/driverRepository");

function idOf(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === "object") return String(value._id || value.id);
  return String(value);
}

function nameOf(value) {
  return value && typeof value === "object" ? value.name || null : null;
}

function rideNotFound() {
  return new AppError("Ride not found.", { status: 404, code: "RIDE_NOT_FOUND" });
}

function counterpartFor(ride, viewerId) {
  const riderId = idOf(ride.rider);
  const driverId = idOf(ride.driver);
  const viewer = String(viewerId);

  if (viewer === riderId && driverId) {
    return { id: driverId, name: nameOf(ride.driver), role: "driver" };
  }
  if (viewer === driverId) {
    return { id: riderId, name: nameOf(ride.rider), role: "rider" };
  }
  throw new AppError("You do not have access to this ride rating.", {
    status: 403,
    code: "RIDE_FORBIDDEN",
  });
}

async function completedRide(req) {
  const ride = await rideRepository.findById(req.params.rideId);
  if (!ride) throw rideNotFound();
  const counterpart = counterpartFor(ride, req.user._id);

  if (ride.status !== "completed") {
    throw new AppError("You can rate after the ride is completed.", {
      status: 409,
      code: "RIDE_NOT_COMPLETED",
    });
  }

  return { ride, counterpart };
}

async function ratingState(req, res) {
  const { ride, counterpart } = await completedRide(req);
  const existing = await ratingRepository.findByRideAndRater(ride._id, req.user._id);

  res.json({
    success: true,
    data: {
      canRate: !existing,
      counterpart,
      rating: serializeRating(existing),
    },
    error: null,
  });
}

async function createRating(req, res) {
  const { ride, counterpart } = await completedRide(req);
  const existing = await ratingRepository.findByRideAndRater(ride._id, req.user._id);
  if (existing) {
    throw new AppError("You have already rated this ride.", {
      status: 409,
      code: "RATING_ALREADY_SUBMITTED",
    });
  }

  let rating;
  try {
    rating = await ratingRepository.create({
      ride: ride._id,
      ratedBy: req.user._id,
      ratedUser: counterpart.id,
      stars: req.body.stars,
      comment: req.body.comment,
    });
  } catch (error) {
    if (error?.code === 11000) {
      throw new AppError("You have already rated this ride.", {
        status: 409,
        code: "RATING_ALREADY_SUBMITTED",
      });
    }
    throw error;
  }

  let driverRating = null;
  if (counterpart.role === "driver") {
    const average = await ratingRepository.averageForUser(counterpart.id);
    const ratingAvg = average.average === null ? 5 : Math.round(average.average * 100) / 100;
    await driverRepository.updateByUser(counterpart.id, { ratingAvg });
    driverRating = { ratingAvg, count: average.count };
  }

  res.status(201).json({
    success: true,
    data: {
      rating: serializeRating(rating),
      counterpart,
      driverRating,
    },
    error: null,
  });
}

module.exports = { ratingState, createRating };
