const express = require("express");
const asyncHandler = require("../utils/asyncHandler");
const { authenticate, requireVerified } = require("../middleware/auth");
const { validateBody } = require("../middleware/validate");
const { ratingSchema } = require("../validation/coreSchemas");
const ratingController = require("../controllers/ratingController");

const router = express.Router();

router.use(authenticate);

router.get("/rides/:rideId", asyncHandler(ratingController.ratingState));
router.post(
  "/rides/:rideId",
  requireVerified,
  validateBody(ratingSchema),
  asyncHandler(ratingController.createRating)
);

module.exports = router;
