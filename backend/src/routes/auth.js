const express = require("express");
const asyncHandler = require("../utils/asyncHandler");
const { signupUpload } = require("../middleware/upload");
const { validateBody } = require("../middleware/validate");
const { authenticate } = require("../middleware/auth");
const { authLimiter, loginLimiter, otpLimiter } = require("../middleware/rateLimits");
const {
  signupSchema,
  verifyOtpSchema,
  resendOtpSchema,
  loginSchema,
} = require("../validation/authSchemas");
const authController = require("../controllers/authController");

const router = express.Router();

router.post(
  "/signup",
  authLimiter,
  signupUpload,
  validateBody(signupSchema),
  asyncHandler(authController.signup)
);

router.post(
  "/verify-otp",
  otpLimiter,
  validateBody(verifyOtpSchema),
  asyncHandler(authController.verifyOtp)
);

router.post(
  "/resend-otp",
  otpLimiter,
  validateBody(resendOtpSchema),
  asyncHandler(authController.resendOtp)
);

router.post(
  "/login",
  loginLimiter,
  validateBody(loginSchema),
  asyncHandler(authController.login)
);

router.get("/me", authenticate, asyncHandler(authController.me));

module.exports = router;
