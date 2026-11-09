const express = require("express");
const asyncHandler = require("../utils/asyncHandler");
const { authenticate } = require("../middleware/auth");
const { validateBody } = require("../middleware/validate");
const { profileSchema } = require("../validation/coreSchemas");
const userController = require("../controllers/userController");

const router = express.Router();

router.use(authenticate);

router.get("/me", asyncHandler(userController.getMe));
router.patch("/me", validateBody(profileSchema), asyncHandler(userController.updateMe));

module.exports = router;
