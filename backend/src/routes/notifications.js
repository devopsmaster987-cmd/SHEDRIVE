const express = require("express");
const asyncHandler = require("../utils/asyncHandler");
const { authenticate } = require("../middleware/auth");
const { validateQuery } = require("../middleware/validate");
const { notificationListQuerySchema } = require("../validation/coreSchemas");
const notificationController = require("../controllers/notificationController");

const router = express.Router();

router.use(authenticate);

router.get(
  "/",
  validateQuery(notificationListQuerySchema),
  asyncHandler(notificationController.list)
);
router.post("/read-all", asyncHandler(notificationController.markAllRead));
router.patch("/:id/read", asyncHandler(notificationController.markRead));

module.exports = router;
