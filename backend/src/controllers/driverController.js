const AppError = require("../utils/AppError");
const serializeDriver = require("../utils/serializeDriver");
const serializeUser = require("../utils/serializeUser");
const driverRepository = require("../repositories/driverRepository");
const { onlineDrivers } = require("../metrics");

function notFound() {
  return new AppError("Driver profile not found.", {
    status: 404,
    code: "DRIVER_PROFILE_NOT_FOUND",
  });
}

function startOfToday() {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

function startOfWeek() {
  const start = startOfToday();
  const mondayOffset = (start.getDay() + 6) % 7;
  start.setDate(start.getDate() - mondayOffset);
  return start;
}

function roundMoney(value) {
  return Math.round(value * 100) / 100;
}

function summarizeEarnings(rides) {
  const todayStart = startOfToday().getTime();
  const weekStart = startOfWeek().getTime();
  const summary = { today: 0, week: 0, total: 0, trips: rides.length, currency: "INR" };

  for (const ride of rides) {
    const amount = Number(ride.finalPrice ?? ride.offeredPrice ?? 0);
    const completedAt = new Date(ride.completedAt || ride.createdAt).getTime();

    if (!Number.isFinite(amount) || !Number.isFinite(completedAt)) continue;

    summary.total += amount;
    if (completedAt >= todayStart) summary.today += amount;
    if (completedAt >= weekStart) summary.week += amount;
  }

  summary.today = roundMoney(summary.today);
  summary.week = roundMoney(summary.week);
  summary.total = roundMoney(summary.total);
  return summary;
}

async function dashboard(req, res) {
  const driver = await driverRepository.findByUser(req.user._id);
  if (!driver) throw notFound();

  const [rides, onlineCount] = await Promise.all([
    driverRepository.completedRides(req.user._id),
    driverRepository.countOnline(),
  ]);

  res.json({
    success: true,
    data: {
      user: serializeUser(req.user),
      driver: serializeDriver(driver),
      earnings: summarizeEarnings(rides),
      onlineDrivers: onlineCount,
    },
    error: null,
  });
}

async function earnings(req, res) {
  const rides = await driverRepository.completedRides(req.user._id);
  res.json({ success: true, data: { earnings: summarizeEarnings(rides) }, error: null });
}

async function updateStatus(req, res) {
  const driver = await driverRepository.findByUser(req.user._id);
  if (!driver) throw notFound();

  if (req.body.isOnline && driver.licenseDocStatus === "rejected") {
    throw new AppError("Your driving licence was not approved. Contact support to go online.", {
      status: 403,
      code: "LICENCE_REJECTED",
    });
  }

  const updated = await driverRepository.updateByUser(req.user._id, {
    isOnline: req.body.isOnline,
  });
  if (!updated) throw notFound();

  const onlineCount = await driverRepository.countOnline();
  onlineDrivers.set(onlineCount);

  res.json({
    success: true,
    data: {
      driver: serializeDriver(updated),
      onlineDrivers: onlineCount,
    },
    error: null,
  });
}

async function updateLocation(req, res) {
  const updated = await driverRepository.updateByUser(req.user._id, {
    currentLocation: {
      type: "Point",
      coordinates: [req.body.lng, req.body.lat],
    },
  });

  if (!updated) throw notFound();

  res.json({
    success: true,
    data: { driver: serializeDriver(updated) },
    error: null,
  });
}

async function nearby(req, res) {
  const { lat, lng, radiusKm } = req.query;
  const drivers = await driverRepository.findNearby({
    lat,
    lng,
    maxDistanceMeters: radiusKm * 1000,
  });

  res.json({
    success: true,
    data: {
      radiusKm,
      drivers: drivers.map((driver) => ({
        id: String(driver._id),
        vehicleType: driver.vehicleType,
        ratingAvg: driver.ratingAvg,
        distanceKm: Math.round((driver.distanceMeters / 1000) * 10) / 10,
        currentLocation: {
          lng: driver.currentLocation.coordinates[0],
          lat: driver.currentLocation.coordinates[1],
        },
      })),
    },
    error: null,
  });
}

module.exports = { dashboard, earnings, updateStatus, updateLocation, nearby };
