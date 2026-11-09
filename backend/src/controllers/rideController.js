const config = require("../config/env");
const AppError = require("../utils/AppError");
const serializeRide = require("../utils/serializeRide");
const serializeOffer = require("../utils/serializeOffer");
const rideRepository = require("../repositories/rideRepository");
const offerRepository = require("../repositories/offerRepository");
const driverRepository = require("../repositories/driverRepository");
const realtime = require("../services/realtime");
const { estimateFare, haversineKm } = require("../services/fareService");

const CANCELLABLE = ["searching", "accepted", "arriving"];
const TRANSITIONS = {
  accepted: "arriving",
  arriving: "in_progress",
  in_progress: "completed",
};

function idOf(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === "object") return String(value._id || value.id);
  return String(value);
}

function notFound() {
  return new AppError("Ride not found.", { status: 404, code: "RIDE_NOT_FOUND" });
}

function forbidden() {
  return new AppError("You do not have access to this ride.", {
    status: 403,
    code: "RIDE_FORBIDDEN",
  });
}

async function driverDetailsFor(userId) {
  if (!userId) return null;
  return driverRepository.findByUser(userId);
}

function assertParticipant(ride, userId) {
  if (![idOf(ride.rider), idOf(ride.driver)].includes(String(userId))) {
    throw forbidden();
  }
}

function serverError(message, code) {
  return new AppError(message, { status: 409, code });
}

async function pendingOffers(rideId) {
  await offerRepository.expireStale(rideId);
  const offers = await offerRepository.findPendingForRide(rideId);
  return offers.map(serializeOffer);
}

async function presentRide(ride, viewerId, { offers = null } = {}) {
  const details = await driverDetailsFor(idOf(ride.driver));
  return serializeRide(ride, { viewerId, driverDetails: details, offers });
}

async function estimate(req, res) {
  const { pickup, drop, vehicleType } = req.body;
  const straightLineKm = haversineKm(pickup, drop);

  if (straightLineKm < 0.05) {
    throw new AppError("Choose a pickup and drop that are farther apart.", {
      status: 422,
      code: "ROUTE_TOO_SHORT",
    });
  }

  res.json({
    success: true,
    data: {
      estimate: {
        ...(await estimateFare({ pickup, drop, vehicleType })),
        pickup,
        drop,
      },
    },
    error: null,
  });
}

async function create(req, res) {
  const { pickup, drop, vehicleType, offeredPrice } = req.body;
  const straightLineKm = haversineKm(pickup, drop);

  if (straightLineKm < 0.05) {
    throw new AppError("Choose a pickup and drop that are farther apart.", {
      status: 422,
      code: "ROUTE_TOO_SHORT",
    });
  }

  const active = await rideRepository.findActiveForRider(req.user._id);
  if (active) {
    throw new AppError("You already have an active ride.", {
      status: 409,
      code: "RIDE_ALREADY_ACTIVE",
      details: [{ rideId: String(active._id || active.id) }],
    });
  }

  const estimate = await estimateFare({ pickup, drop, vehicleType });
  const created = await rideRepository.create({
    rider: req.user._id,
    pickup: { type: "Point", coordinates: [pickup.lng, pickup.lat] },
    drop: { type: "Point", coordinates: [drop.lng, drop.lat] },
    pickupLabel: pickup.label,
    dropLabel: drop.label,
    vehicleType,
    distanceKm: estimate.distanceKm,
    durationMinutes: estimate.durationMinutes,
    offeredPrice,
    status: "searching",
  });

  const ride = (await rideRepository.findById(created._id || created.id)) || created;
  const nearby = await driverRepository.findNearby({
    lat: pickup.lat,
    lng: pickup.lng,
    maxDistanceMeters: config.ride.searchRadiusKm * 1000,
    vehicleType,
  });

  const payload = serializeRide(ride, { viewerId: req.user._id });
  for (const driver of nearby) {
    if (driver.user) realtime.emitToUser(driver.user, "ride:request", { ride: payload });
  }

  res.status(201).json({
    success: true,
    data: { ride: payload, driversNotified: nearby.length },
    error: null,
  });
}

async function active(req, res) {
  const ride =
    req.user.role === "driver"
      ? await rideRepository.findActiveForDriver(req.user._id)
      : await rideRepository.findActiveForRider(req.user._id);

  if (!ride) {
    res.json({ success: true, data: { ride: null }, error: null });
    return;
  }

  const offers = req.user.role === "rider" ? await pendingOffers(ride._id) : null;
  const payload = await presentRide(ride, req.user._id, { offers });

  res.json({ success: true, data: { ride: payload }, error: null });
}

async function getRide(req, res) {
  const ride = await rideRepository.findById(req.params.id);
  if (!ride) throw notFound();
  assertParticipant(ride, req.user._id);

  const offers = req.user.role === "rider" ? await pendingOffers(ride._id) : null;
  const payload = await presentRide(ride, req.user._id, { offers });

  res.json({ success: true, data: { ride: payload }, error: null });
}

async function listOffers(req, res) {
  const ride = await rideRepository.findById(req.params.id);
  if (!ride) throw notFound();
  if (idOf(ride.rider) !== String(req.user._id)) throw forbidden();

  res.json({
    success: true,
    data: { offers: await pendingOffers(ride._id) },
    error: null,
  });
}

async function createOffer(req, res) {
  const driver = await driverRepository.findByUser(req.user._id);
  if (!driver) {
    throw new AppError("Driver profile not found.", {
      status: 404,
      code: "DRIVER_PROFILE_NOT_FOUND",
    });
  }
  if (!driver.isOnline) {
    throw new AppError("Go online before sending an offer.", {
      status: 409,
      code: "DRIVER_OFFLINE",
    });
  }
  if (driver.activeRide) {
    throw new AppError("Finish your active ride before taking another.", {
      status: 409,
      code: "DRIVER_ACTIVE_RIDE",
    });
  }
  if (driver.licenseDocStatus === "rejected") {
    throw new AppError("Your driving licence was not approved. Contact support.", {
      status: 403,
      code: "LICENCE_REJECTED",
    });
  }

  const ride = await rideRepository.findById(req.params.id);
  if (!ride) throw notFound();
  if (ride.status !== "searching") {
    throw serverError("This ride is no longer taking offers.", "RIDE_NOT_OPEN");
  }
  if (ride.vehicleType !== driver.vehicleType) {
    throw new AppError("This rider chose a different vehicle type.", {
      status: 422,
      code: "VEHICLE_MISMATCH",
    });
  }

  await offerRepository.expireStale(ride._id);
  const offer = await offerRepository.upsertPending({
    ride: ride._id,
    driver: req.user._id,
    driverName: req.user.name,
    vehicleType: driver.vehicleType,
    plateNumber: driver.plateNumber,
    ratingAvg: driver.ratingAvg,
    offerPrice: req.body.offerPrice,
    note: req.body.note,
    expiresAt: new Date(Date.now() + config.ride.offerTtlSeconds * 1000),
  });

  const payload = { offer: serializeOffer(offer) };
  realtime.emitToRide(ride._id, "offer:new", payload);
  realtime.emitToUser(ride.rider?._id || ride.rider, "offer:new", payload);

  res.status(201).json({ success: true, data: payload, error: null });
}

async function acceptOffer(req, res) {
  const ride = await rideRepository.findById(req.params.id);
  if (!ride) throw notFound();
  if (idOf(ride.rider) !== String(req.user._id)) throw forbidden();
  if (ride.status !== "searching") {
    throw serverError("This ride already has a driver.", "RIDE_ALREADY_ACCEPTED");
  }

  await offerRepository.expireStale(ride._id);
  const offer = await offerRepository.findById(req.params.offerId);
  if (!offer || String(offer.ride) !== String(ride._id)) throw notFound();
  if (offer.status !== "pending" || new Date(offer.expiresAt).getTime() <= Date.now()) {
    throw serverError("That offer has expired or is no longer available.", "OFFER_UNAVAILABLE");
  }

  const acceptedAt = new Date();
  const assigned = await rideRepository.assignDriver(ride._id, {
    driver: offer.driver,
    finalPrice: offer.offerPrice,
    offerId: offer._id,
    acceptedAt,
  });
  if (!assigned) {
    throw serverError("Another offer was accepted first.", "RIDE_ALREADY_ACCEPTED");
  }

  await Promise.all([
    offerRepository.markAccepted(offer._id, acceptedAt),
    offerRepository.rejectOthers(ride._id, offer._id, acceptedAt),
    driverRepository.updateByUser(offer.driver, { activeRide: ride._id }),
  ]);

  const details = await driverDetailsFor(offer.driver);
  const ridePayload = serializeRide(assigned, {
    viewerId: req.user._id,
    driverDetails: details,
  });
  const rawOffer = typeof offer.toObject === "function" ? offer.toObject() : offer;
  const offerPayload = serializeOffer({
    ...rawOffer,
    status: "accepted",
    respondedAt: acceptedAt,
  });

  realtime.emitRideEvent(assigned, "offer:accepted", {
    ride: ridePayload,
    offer: offerPayload,
  });
  realtime.emitRideEvent(assigned, "ride:status", { ride: ridePayload });

  res.json({
    success: true,
    data: { ride: ridePayload, offer: offerPayload },
    error: null,
  });
}

async function updateStatus(req, res) {
  const ride = await rideRepository.findById(req.params.id);
  if (!ride) throw notFound();
  if (idOf(ride.driver) !== String(req.user._id)) throw forbidden();

  const nextStatus = req.body.status;
  if (TRANSITIONS[ride.status] !== nextStatus) {
    throw serverError(
      `A ${ride.status} ride cannot move to ${nextStatus}.`,
      "INVALID_RIDE_TRANSITION"
    );
  }

  const now = new Date();
  const updates = { status: nextStatus };
  if (nextStatus === "arriving") updates.arrivedAt = now;
  if (nextStatus === "in_progress") updates.startedAt = now;
  if (nextStatus === "completed") {
    updates.completedAt = now;
    updates.finalPrice = ride.finalPrice ?? ride.offeredPrice;
  }

  const updated = await rideRepository.updateById(ride._id, updates, {
    filter: { driver: req.user._id, status: ride.status },
  });
  if (!updated) {
    throw serverError("That ride status changed. Refresh and try again.", "RIDE_STATUS_CHANGED");
  }

  if (nextStatus === "completed") {
    await driverRepository.updateByUser(req.user._id, { activeRide: null });
  }

  const payload = await presentRide(updated, req.user._id);
  realtime.emitRideEvent(updated, "ride:status", { ride: payload });

  res.json({ success: true, data: { ride: payload }, error: null });
}

async function cancel(req, res) {
  const ride = await rideRepository.findById(req.params.id);
  if (!ride) throw notFound();
  assertParticipant(ride, req.user._id);

  if (!CANCELLABLE.includes(ride.status)) {
    throw serverError("This ride can no longer be cancelled.", "RIDE_NOT_CANCELLABLE");
  }

  const cancelledBy = req.user.role === "driver" ? "driver" : "rider";
  const updated = await rideRepository.updateById(
    ride._id,
    {
      status: "cancelled",
      cancelledAt: new Date(),
      cancelledBy,
      cancellationReason: req.body.reason || "",
    },
    { filter: { status: ride.status } }
  );
  if (!updated) {
    throw serverError("That ride changed before it could be cancelled.", "RIDE_STATUS_CHANGED");
  }

  await offerRepository.rejectForRide(ride._id);
  if (ride.driver) {
    await driverRepository.updateByUser(idOf(ride.driver), { activeRide: null });
  }

  const payload = await presentRide(updated, req.user._id);
  realtime.emitRideEvent(updated, "ride:status", { ride: payload });

  res.json({ success: true, data: { ride: payload }, error: null });
}

async function opportunities(req, res) {
  const driver = await driverRepository.findByUser(req.user._id);
  if (!driver || !driver.isOnline || driver.activeRide || !driver.currentLocation) {
    res.json({ success: true, data: { rides: [] }, error: null });
    return;
  }

  const [lng, lat] = driver.currentLocation.coordinates;
  const rides = await rideRepository.findNearbySearching({
    lat,
    lng,
    maxDistanceMeters: config.ride.searchRadiusKm * 1000,
    vehicleType: driver.vehicleType,
    since: new Date(Date.now() - config.ride.requestTtlMinutes * 60000),
  });

  res.json({
    success: true,
    data: {
      rides: rides.map((ride) => serializeRide(ride, { viewerId: req.user._id })),
    },
    error: null,
  });
}

async function history(req, res) {
  const rides = await rideRepository.listForUser(req.user._id, { limit: req.query.limit });
  res.json({
    success: true,
    data: { rides: rides.map((ride) => serializeRide(ride, { viewerId: req.user._id })) },
    error: null,
  });
}

module.exports = {
  estimate,
  create,
  active,
  getRide,
  listOffers,
  createOffer,
  acceptOffer,
  updateStatus,
  cancel,
  opportunities,
  history,
};
