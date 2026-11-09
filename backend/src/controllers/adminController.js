const AppError = require("../utils/AppError");
const serializeUser = require("../utils/serializeUser");
const serializeSosAlert = require("../utils/serializeSosAlert");
const userRepository = require("../repositories/userRepository");
const reviewRepository = require("../repositories/reviewRepository");
const adminRepository = require("../repositories/adminRepository");
const sosRepository = require("../repositories/sosRepository");
const notificationRepository = require("../repositories/notificationRepository");
const storageService = require("../services/storageService");
const realtime = require("../services/realtime");
const { openSosAlerts } = require("../metrics");

const REVIEW_STATUSES = new Set(["pending", "approved", "rejected", "all"]);

function parsePositiveInt(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function idOf(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === "object") return String(value._id || value.id);
  return String(value);
}

function nameOf(value) {
  return value && typeof value === "object" ? value.name || null : null;
}

function iso(value) {
  if (!value) return null;
  return value instanceof Date ? value.toISOString() : value;
}

async function notify(userId, payload) {
  if (!userId) return;
  try {
    await notificationRepository.create({ user: userId, ...payload });
  } catch (error) {
    if (process.env.NODE_ENV !== "test") {
      console.error("[admin] notification failed:", error.message);
    }
  }
}

async function refreshSosMetric() {
  try {
    openSosAlerts.set(await sosRepository.countOpen());
  } catch {
    // A stale metric must not block a safety action.
  }
}

function adminUserPayload(raw) {
  const driver = raw.driver || null;
  return {
    id: String(raw._id || raw.id),
    name: raw.name,
    email: raw.email,
    phone: raw.phone,
    role: raw.role,
    verificationStatus: raw.verificationStatus,
    phoneVerified: Boolean(raw.phoneVerified),
    walletBalance: Number(raw.walletBalance) || 0,
    isBanned: Boolean(raw.isBanned),
    moderationReason: raw.moderationReason || "",
    createdAt: iso(raw.createdAt),
    driver: driver
      ? {
          id: String(driver._id || driver.id),
          vehicleType: driver.vehicleType,
          plateNumber: driver.plateNumber,
          licenseDocStatus: driver.licenseDocStatus,
          ratingAvg: driver.ratingAvg,
          isOnline: Boolean(driver.isOnline),
          activeRide: idOf(driver.activeRide),
        }
      : null,
  };
}

function driverDocPayload(raw) {
  const user = raw.user;
  return {
    id: String(raw._id || raw.id),
    vehicleType: raw.vehicleType,
    plateNumber: raw.plateNumber,
    licenseDocUrl: raw.licenseDocUrl,
    licenseDocStatus: raw.licenseDocStatus,
    licenseDocNote: raw.licenseDocNote || "",
    licenseDocReviewedAt: iso(raw.licenseDocReviewedAt),
    createdAt: iso(raw.createdAt),
    user:
      user && typeof user === "object"
        ? {
            id: String(user._id || user.id),
            name: user.name,
            email: user.email,
            phone: user.phone,
            verificationStatus: user.verificationStatus,
            isBanned: Boolean(user.isBanned),
          }
        : { id: idOf(user), name: null, email: null, phone: null },
  };
}

function recentRidePayload(raw) {
  return {
    id: String(raw._id || raw.id),
    status: raw.status,
    rider: { id: idOf(raw.rider), name: nameOf(raw.rider) },
    driver: { id: idOf(raw.driver), name: nameOf(raw.driver) },
    pickupLabel: raw.pickupLabel || "",
    dropLabel: raw.dropLabel || "",
    finalPrice: raw.finalPrice ?? raw.offeredPrice ?? 0,
    createdAt: iso(raw.createdAt),
  };
}

async function listReviewQueue(req, res) {
  const status = req.query.status || "pending";
  if (!REVIEW_STATUSES.has(status)) {
    throw new AppError("Unknown review status.", {
      status: 422,
      code: "VALIDATION_ERROR",
      details: [{ field: "status", message: "Unknown review status." }],
    });
  }

  const page = parsePositiveInt(req.query.page, 1);
  const limit = Math.min(100, parsePositiveInt(req.query.limit, 20));
  const { items, total } = await reviewRepository.list({ status, page, limit });

  res.json({
    success: true,
    data: { items, total, page, limit },
    error: null,
  });
}

async function reviewQueueEntry(req, res) {
  const review = await reviewRepository.findById(req.params.id);
  if (!review) {
    throw new AppError("Review item not found.", {
      status: 404,
      code: "REVIEW_NOT_FOUND",
    });
  }

  if (review.status !== "pending") {
    throw new AppError("This account has already been reviewed.", {
      status: 409,
      code: "ALREADY_REVIEWED",
    });
  }

  const userId = review.user?._id || review.user;
  const updatedUser = await userRepository.updateById(userId, {
    verificationStatus: req.body.status,
  });

  if (!updatedUser) {
    throw new AppError("The reviewed account no longer exists.", {
      status: 404,
      code: "ACCOUNT_NOT_FOUND",
    });
  }

  const updatedReview = await reviewRepository.update(review, {
    status: req.body.status,
    note: req.body.note || "",
    reviewedBy: req.user._id,
    reviewedAt: new Date(),
  });

  await notify(userId, {
    type: "account",
    title:
      req.body.status === "approved"
        ? "Your SheDrive account is verified"
        : "Your SheDrive review has an update",
    message:
      req.body.status === "approved"
        ? "A safety team member approved your account. Rides are now unlocked."
        : req.body.note || "A safety team member reviewed your account. Contact support for details.",
  });

  res.json({
    success: true,
    data: {
      review: {
        id: String(updatedReview._id || review._id),
        status: updatedReview.status,
        note: updatedReview.note || "",
        reviewedAt: updatedReview.reviewedAt,
      },
      user: serializeUser(updatedUser),
    },
    error: null,
  });
}

async function driverDocument(req, res) {
  const document = await storageService.readLicenseDoc(req.params.filename);

  res.set("Cache-Control", "private, no-store");
  res.type(document.contentType);
  res.set("Content-Disposition", `inline; filename="${document.filename}"`);
  res.send(document.buffer);
}

async function stats(req, res) {
  const [summary, sosResult, rides] = await Promise.all([
    adminRepository.stats(),
    sosRepository.list({ status: "open", page: 1, limit: 4 }),
    adminRepository.recentRides(6),
  ]);

  openSosAlerts.set(summary.openSos);

  res.json({
    success: true,
    data: {
      stats: summary,
      recentSos: sosResult.items.map(serializeSosAlert),
      recentRides: rides.map(recentRidePayload),
    },
    error: null,
  });
}

async function listUsers(req, res) {
  const { items, total } = await adminRepository.listUsers({
    role: req.query.role,
    status: req.query.status,
    search: req.query.search,
    page: req.query.page,
    limit: req.query.limit,
  });

  res.json({
    success: true,
    data: {
      items: items.map(adminUserPayload),
      total,
      page: req.query.page,
      limit: req.query.limit,
    },
    error: null,
  });
}

async function updateUserAccess(req, res) {
  const target = await userRepository.findById(req.params.id);
  if (!target) {
    throw new AppError("Account not found.", { status: 404, code: "ACCOUNT_NOT_FOUND" });
  }
  if (String(target._id) === String(req.user._id)) {
    throw new AppError("You cannot change your own access.", {
      status: 409,
      code: "ADMIN_SELF_PROTECTED",
    });
  }
  if (target.role === "admin") {
    throw new AppError("Admin accounts cannot be suspended here.", {
      status: 403,
      code: "ADMIN_PROTECTED",
    });
  }

  const updated = await userRepository.updateById(target._id, {
    isBanned: req.body.banned,
    moderationReason: req.body.reason || "",
    moderatedAt: new Date(),
  });

  if (req.body.banned && updated.role === "driver") {
    await adminRepository.setDriverOffline(updated._id);
  }

  await notify(updated._id, {
    type: "account",
    title: req.body.banned ? "Your account is suspended" : "Your account is active again",
    message: req.body.banned
      ? req.body.reason || "Contact support if you believe this was a mistake."
      : "Your SheDrive access has been restored.",
  });
  realtime.emitToUser(updated._id, "account:updated", {
    userId: String(updated._id),
    isBanned: Boolean(updated.isBanned),
  });

  res.json({
    success: true,
    data: { user: adminUserPayload({ ...serializeUser(updated), driver: null }) },
    error: null,
  });
}

async function listDriverDocs(req, res) {
  const { items, total } = await adminRepository.listDriverDocs({
    status: req.query.status,
    page: req.query.page,
    limit: req.query.limit,
  });

  res.json({
    success: true,
    data: {
      items: items.map(driverDocPayload),
      total,
      page: req.query.page,
      limit: req.query.limit,
    },
    error: null,
  });
}

async function reviewDriverDoc(req, res) {
  const document = await adminRepository.findDriverDocById(req.params.id);
  if (!document) {
    throw new AppError("Driver document not found.", {
      status: 404,
      code: "DRIVER_DOCUMENT_NOT_FOUND",
    });
  }

  const updated = await adminRepository.updateDriverDoc(document._id, {
    licenseDocStatus: req.body.status,
    licenseDocNote: req.body.note || "",
    licenseDocReviewedAt: new Date(),
    licenseDocReviewedBy: req.user._id,
  });

  if (req.body.status === "rejected") {
    await adminRepository.setDriverOffline(idOf(document.user));
  }

  await notify(idOf(document.user), {
    type: "account",
    title:
      req.body.status === "approved"
        ? "Your driving licence is approved"
        : "Your driving licence needs attention",
    message:
      req.body.status === "approved"
        ? "Your licence document passed review. You can go online and accept rides."
        : req.body.note || "Your licence document was not approved. Contact support for details.",
  });

  res.json({
    success: true,
    data: { document: driverDocPayload(updated) },
    error: null,
  });
}

async function listSosAlerts(req, res) {
  const { items, total } = await sosRepository.list({
    status: req.query.status,
    page: req.query.page,
    limit: req.query.limit,
  });

  res.json({
    success: true,
    data: {
      alerts: items.map(serializeSosAlert),
      total,
      page: req.query.page,
      limit: req.query.limit,
    },
    error: null,
  });
}

async function updateSosAlert(req, res) {
  const alert = await sosRepository.findById(req.params.id);
  if (!alert) {
    throw new AppError("SOS alert not found.", { status: 404, code: "SOS_NOT_FOUND" });
  }
  if (alert.status === "resolved") {
    throw new AppError("This SOS alert is already resolved.", {
      status: 409,
      code: "SOS_ALREADY_RESOLVED",
    });
  }

  const now = new Date();
  const updates = {
    status: req.body.status,
    note: req.body.note || alert.note || "",
    handledBy: req.user._id,
    acknowledgedAt: alert.acknowledgedAt || now,
  };
  if (req.body.status === "resolved") updates.resolvedAt = now;

  const updated = await sosRepository.updateById(alert._id, updates);
  const payload = { alert: serializeSosAlert(updated) };
  const alertUser = idOf(updated.user);

  await notify(alertUser, {
    type: "sos",
    title:
      req.body.status === "resolved"
        ? "Your SOS alert is resolved"
        : "The safety desk is handling your SOS",
    message:
      req.body.status === "resolved"
        ? req.body.note || "Your safety desk marked the alert resolved. Stay safe."
        : req.body.note || "A safety team member has acknowledged your alert and is with you.",
    ride: idOf(updated.ride),
    sosAlert: updated._id,
  });

  realtime.emitToUser(alertUser, "sos:updated", payload);
  realtime.emitToAdmins("sos:updated", payload);
  await refreshSosMetric();

  res.json({ success: true, data: payload, error: null });
}

module.exports = {
  listReviewQueue,
  reviewQueueEntry,
  driverDocument,
  stats,
  listUsers,
  updateUserAccess,
  listDriverDocs,
  reviewDriverDoc,
  listSosAlerts,
  updateSosAlert,
};
