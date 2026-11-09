const express = require("express");
const asyncHandler = require("../utils/asyncHandler");
const { authenticate, requireRole, requireVerified } = require("../middleware/auth");
const { validateBody } = require("../middleware/validate");
const { walletTopupSchema, ridePaymentSchema } = require("../validation/coreSchemas");
const paymentController = require("../controllers/paymentController");

const router = express.Router();

router.use(authenticate);

router.get("/wallet", requireRole("rider"), asyncHandler(paymentController.wallet));
router.post(
  "/wallet/topup",
  requireRole("rider"),
  requireVerified,
  validateBody(walletTopupSchema),
  asyncHandler(paymentController.topUp)
);

router.get("/rides/:rideId", asyncHandler(paymentController.ridePayment));
router.post(
  "/rides/:rideId",
  requireRole("rider"),
  requireVerified,
  validateBody(ridePaymentSchema),
  asyncHandler(paymentController.payRide)
);

module.exports = router;
