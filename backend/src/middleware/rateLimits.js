const rateLimit = require("express-rate-limit");
const config = require("../config/env");

const skip = () => config.nodeEnv === "test";

function limiter(limit, code, message) {
  return rateLimit({
    windowMs: 15 * 60 * 1000,
    limit,
    standardHeaders: "draft-7",
    legacyHeaders: false,
    skip,
    message: {
      success: false,
      data: null,
      error: { code, message },
    },
  });
}

const authLimiter = limiter(
  20,
  "AUTH_RATE_LIMITED",
  "Too many attempts. Please wait a few minutes and try again."
);

const loginLimiter = limiter(
  10,
  "LOGIN_RATE_LIMITED",
  "Too many login attempts. Please wait a few minutes and try again."
);

const otpLimiter = limiter(
  10,
  "OTP_RATE_LIMITED",
  "Too many verification attempts. Please wait a few minutes and try again."
);

module.exports = { authLimiter, loginLimiter, otpLimiter };
