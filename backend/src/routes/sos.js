const express = require("express");
const asyncHandler = require("../utils/asyncHandler");
const { authenticate, requireRole, requireVerified } = require("../middleware/auth");
const { validateBody } = require("../middleware/validate");
const { sosCreateSchema } = require("../validation/coreSchemas");
const sosController = require("../controllers/sosController");

const router = express.Router();

router.use(authenticate);

router.get("/alerts/mine", asyncHandler(sosController.mine));
router.post(
  "/alerts",
  requireRole("rider", "driver"),
  requireVerified,
  validateBody(sosCreateSchema),
  asyncHandler(sosController.create)
);

module.exports = router;
