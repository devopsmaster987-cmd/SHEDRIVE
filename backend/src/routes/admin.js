const express = require("express");
const asyncHandler = require("../utils/asyncHandler");
const { authenticate, requireRole } = require("../middleware/auth");
const { validateBody, validateQuery } = require("../middleware/validate");
const { reviewSchema } = require("../validation/authSchemas");
const {
  adminUsersQuerySchema,
  driverDocListQuerySchema,
  driverDocReviewSchema,
  sosListQuerySchema,
  sosUpdateSchema,
  userAccessSchema,
} = require("../validation/coreSchemas");
const adminController = require("../controllers/adminController");

const router = express.Router();

router.use(authenticate, requireRole("admin"));

router.get("/stats", asyncHandler(adminController.stats));
router.get(
  "/users",
  validateQuery(adminUsersQuerySchema),
  asyncHandler(adminController.listUsers)
);
router.patch(
  "/users/:id/access",
  validateBody(userAccessSchema),
  asyncHandler(adminController.updateUserAccess)
);

router.get("/review-queue", asyncHandler(adminController.listReviewQueue));
router.patch(
  "/review-queue/:id",
  validateBody(reviewSchema),
  asyncHandler(adminController.reviewQueueEntry)
);

router.get(
  "/driver-documents",
  validateQuery(driverDocListQuerySchema),
  asyncHandler(adminController.listDriverDocs)
);
router.get(
  "/driver-documents/:filename",
  asyncHandler(adminController.driverDocument)
);
router.patch(
  "/driver-documents/:id",
  validateBody(driverDocReviewSchema),
  asyncHandler(adminController.reviewDriverDoc)
);

router.get(
  "/sos-alerts",
  validateQuery(sosListQuerySchema),
  asyncHandler(adminController.listSosAlerts)
);
router.patch(
  "/sos-alerts/:id",
  validateBody(sosUpdateSchema),
  asyncHandler(adminController.updateSosAlert)
);

module.exports = router;
