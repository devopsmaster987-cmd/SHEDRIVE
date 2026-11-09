const crypto = require("node:crypto");
const config = require("../config/env");
const AppError = require("../utils/AppError");

function generateOtp() {
  return String(crypto.randomInt(0, 1_000_000)).padStart(6, "0");
}

function hashOtp(code) {
  return crypto
    .createHmac("sha256", config.jwt.secret)
    .update(`otp:${String(code)}`)
    .digest("hex");
}

function otpMatches(code, expectedHash) {
  const actual = Buffer.from(hashOtp(code), "hex");
  const expected = Buffer.from(String(expectedHash || ""), "hex");
  if (actual.length !== expected.length) return false;
  return crypto.timingSafeEqual(actual, expected);
}

function maskPhone(phone) {
  const value = String(phone || "");
  if (value.length <= 4) return "****";
  return `${"*".repeat(Math.max(0, value.length - 4))}${value.slice(-4)}`;
}

const providers = {
  mock: {
    available: true,
    async send({ phone, code }) {
      console.info(`[otp:mock] code=${code} phone=${maskPhone(phone)}`);
    },
  },
  twilio: {
    available: false,
    async send() {
      throw new AppError("Twilio OTP delivery is not configured in this build.", {
        status: 501,
        code: "OTP_PROVIDER_UNAVAILABLE",
      });
    },
  },
  fast2sms: {
    available: false,
    async send() {
      throw new AppError("Fast2SMS OTP delivery is not configured in this build.", {
        status: 501,
        code: "OTP_PROVIDER_UNAVAILABLE",
      });
    },
  },
};

function getProvider() {
  const provider = providers[config.otpProvider];
  if (!provider) {
    throw new AppError("The configured OTP provider is not supported.", {
      status: 500,
      code: "OTP_PROVIDER_INVALID",
    });
  }
  return provider;
}

function assertOtpProviderReady() {
  const provider = getProvider();
  if (!provider.available) {
    throw new AppError("OTP delivery is not configured in this build.", {
      status: 501,
      code: "OTP_PROVIDER_UNAVAILABLE",
    });
  }
}

async function sendOtp({ phone, code }) {
  const provider = getProvider();
  await provider.send({ phone, code });
}

module.exports = {
  generateOtp,
  hashOtp,
  otpMatches,
  sendOtp,
  assertOtpProviderReady,
};
