const AppError = require("../utils/AppError");
const serializeSosAlert = require("../utils/serializeSosAlert");
const rideRepository = require("../repositories/rideRepository");
const sosRepository = require("../repositories/sosRepository");
const notificationRepository = require("../repositories/notificationRepository");
const userRepository = require("../repositories/userRepository");
const notificationService = require("../services/notificationService");
const realtime = require("../services/realtime");
const { openSosAlerts } = require("../metrics");

const ACTIVE_RIDE_STATUSES = ["accepted", "arriving", "in_progress"];

function idOf(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === "object") return String(value._id || value.id);
  return String(value);
}

function rideCoordinates(ride) {
  const coordinates = ride?.pickup?.coordinates;
  if (!Array.isArray(coordinates) || coordinates.length !== 2) return null;
  return { lng: Number(coordinates[0]), lat: Number(coordinates[1]) };
}

async function refreshOpenMetric() {
  try {
    openSosAlerts.set(await sosRepository.countOpen());
  } catch {
    // Metrics must never block an emergency action.
  }
}

async function create(req, res) {
  const ride = await rideRepository.findById(req.body.rideId);
  if (!ride) {
    throw new AppError("Ride not found.", { status: 404, code: "RIDE_NOT_FOUND" });
  }

  const userId = String(req.user._id);
  if (![idOf(ride.rider), idOf(ride.driver)].includes(userId)) {
    throw new AppError("You do not have access to this ride.", {
      status: 403,
      code: "RIDE_FORBIDDEN",
    });
  }

  if (!ACTIVE_RIDE_STATUSES.includes(ride.status)) {
    throw new AppError("SOS is available during an active ride.", {
      status: 409,
      code: "SOS_RIDE_NOT_ACTIVE",
    });
  }

  const existing = await sosRepository.findOpenForUser(req.user._id);
  if (existing) {
    throw new AppError("You already have an active SOS alert.", {
      status: 409,
      code: "SOS_ALREADY_OPEN",
      details: [{ alertId: String(existing._id || existing.id) }],
    });
  }

  const fallback = rideCoordinates(ride);
  const location =
    Number.isFinite(Number(req.body.lat)) && Number.isFinite(Number(req.body.lng))
      ? { lng: Number(req.body.lng), lat: Number(req.body.lat) }
      : fallback;

  if (!location) {
    throw new AppError("Share a location so the safety desk can find you.", {
      status: 422,
      code: "SOS_LOCATION_REQUIRED",
    });
  }

  let alert = await sosRepository.create({
    ride: ride._id,
    user: req.user._id,
    location: { type: "Point", coordinates: [location.lng, location.lat] },
    message: req.body.message || "",
    raisedAt: new Date(),
    status: "open",
  });

  const dispatch = await notificationService.dispatchSosAlert(alert, req.user);
  alert = await sosRepository.updateById(alert._id || alert.id, {
    contactsNotified: dispatch.contactsNotified,
  });

  const admins = await userRepository.findAdminIds();
  const notificationEntries = [
    {
      user: req.user._id,
      type: "sos",
      title: "SOS shared with the safety desk",
      message:
        dispatch.contactsNotified > 0
          ? `Your safety desk alert is active and ${dispatch.contactsNotified} emergency contact${dispatch.contactsNotified === 1 ? "" : "s"} were notified.`
          : "Your safety desk alert is active. Add emergency contacts in your profile so they can be reached too.",
      ride: ride._id,
      sosAlert: alert._id || alert.id,
    },
    ...admins.map((adminId) => ({
      user: adminId,
      type: "sos",
      title: `SOS from ${req.user.name}`,
      message: `${req.user.name} raised an SOS on ride #${String(ride._id || ride.id).slice(-6).toUpperCase()}.`,
      ride: ride._id,
      sosAlert: alert._id || alert.id,
    })),
  ];
  await notificationRepository.createMany(notificationEntries);

  const payload = { alert: serializeSosAlert(alert) };
  realtime.emitToAdmins("sos:triggered", payload);
  realtime.emitToUser(req.user._id, "sos:created", payload);
  await refreshOpenMetric();

  res.status(201).json({
    success: true,
    data: {
      alert: payload.alert,
      notifications: {
        contactsNotified: dispatch.contactsNotified,
        channels: dispatch.channels,
      },
    },
    error: null,
  });
}

async function mine(req, res) {
  const alert = await sosRepository.findOpenForUser(req.user._id);
  res.json({
    success: true,
    data: { alert: serializeSosAlert(alert) },
    error: null,
  });
}

module.exports = { create, mine };
