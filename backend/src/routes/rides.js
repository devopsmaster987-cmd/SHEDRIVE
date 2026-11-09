const express = require("express");
const asyncHandler = require("../utils/asyncHandler");
const { authenticate, requireRole, requireVerified } = require("../middleware/auth");
const { validateBody, validateQuery } = require("../middleware/validate");
const {
  estimateSchema,
  createRideSchema,
  createOfferSchema,
  rideStatusSchema,
  cancelRideSchema,
  rideListQuerySchema,
} = require("../validation/coreSchemas");
const rideController = require("../controllers/rideController");

const router = express.Router();

router.post(
  "/estimate",
  authenticate,
  requireRole("rider"),
  validateBody(estimateSchema),
  asyncHandler(rideController.estimate)
);

router.post(
  "/",
  authenticate,
  requireRole("rider"),
  requireVerified,
  validateBody(createRideSchema),
  asyncHandler(rideController.create)
);

router.get("/active", authenticate, asyncHandler(rideController.active));

router.get(
  "/opportunities",
  authenticate,
  requireRole("driver"),
  requireVerified,
  asyncHandler(rideController.opportunities)
);

router.get(
  "/",
  authenticate,
  validateQuery(rideListQuerySchema),
  asyncHandler(rideController.history)
);

router.get("/:id", authenticate, asyncHandler(rideController.getRide));

router.get(
  "/:id/offers",
  authenticate,
  requireRole("rider"),
  asyncHandler(rideController.listOffers)
);

router.post(
  "/:id/offers",
  authenticate,
  requireRole("driver"),
  requireVerified,
  validateBody(createOfferSchema),
  asyncHandler(rideController.createOffer)
);

router.post(
  "/:id/offers/:offerId/accept",
  authenticate,
  requireRole("rider"),
  requireVerified,
  asyncHandler(rideController.acceptOffer)
);

router.patch(
  "/:id/status",
  authenticate,
  requireRole("driver"),
  requireVerified,
  validateBody(rideStatusSchema),
  asyncHandler(rideController.updateStatus)
);

router.post(
  "/:id/cancel",
  authenticate,
  requireVerified,
  validateBody(cancelRideSchema),
  asyncHandler(rideController.cancel)
);

module.exports = router;
