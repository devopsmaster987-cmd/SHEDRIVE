const express = require("express");
const asyncHandler = require("../utils/asyncHandler");
const { authenticate, requireRole, requireVerified } = require("../middleware/auth");
const { validateBody, validateQuery } = require("../middleware/validate");
const {
  nearbyQuerySchema,
  driverStatusSchema,
  driverLocationSchema,
} = require("../validation/coreSchemas");
const driverController = require("../controllers/driverController");

const router = express.Router();

router.get(
  "/nearby",
  authenticate,
  requireRole("rider"),
  validateQuery(nearbyQuerySchema),
  asyncHandler(driverController.nearby)
);

router.get(
  "/me",
  authenticate,
  requireRole("driver"),
  asyncHandler(driverController.dashboard)
);

router.get(
  "/me/earnings",
  authenticate,
  requireRole("driver"),
  asyncHandler(driverController.earnings)
);

router.patch(
  "/me/status",
  authenticate,
  requireRole("driver"),
  requireVerified,
  validateBody(driverStatusSchema),
  asyncHandler(driverController.updateStatus)
);

router.patch(
  "/me/location",
  authenticate,
  requireRole("driver"),
  requireVerified,
  validateBody(driverLocationSchema),
  asyncHandler(driverController.updateLocation)
);

module.exports = router;
