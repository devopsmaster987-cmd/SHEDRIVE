const Joi = require("joi");

const email = Joi.string()
  .trim()
  .lowercase()
  .email({ tlds: { allow: false } })
  .max(160)
  .required();
const password = Joi.string()
  .min(8)
  .max(72)
  .pattern(/[A-Za-z]/)
  .pattern(/[0-9]/)
  .required()
  .messages({
    "string.min": "Password must be at least 8 characters.",
    "string.max": "Password must be 72 characters or fewer.",
    "string.pattern.base": "Password must include at least one letter and one number.",
  });

const signupSchema = Joi.object({
  name: Joi.string().trim().min(2).max(80).required(),
  email,
  phone: Joi.string()
    .trim()
    .pattern(/^\+?[0-9][0-9\s-]{6,18}$/)
    .required()
    .messages({ "string.pattern.base": "Enter a valid phone number." }),
  password,
  role: Joi.string().valid("rider", "driver").required(),
  vehicleType: Joi.when("role", {
    is: "driver",
    then: Joi.string().valid("Car", "Auto", "Bike").required(),
    otherwise: Joi.string().allow("").optional(),
  }),
  plateNumber: Joi.when("role", {
    is: "driver",
    then: Joi.string()
      .trim()
      .uppercase()
      .pattern(/^[A-Z0-9][A-Z0-9 -]{3,13}$/)
      .required()
      .messages({ "string.pattern.base": "Enter a valid plate number." }),
    otherwise: Joi.string().allow("").optional(),
  }),
});

const verifyOtpSchema = Joi.object({
  email,
  otp: Joi.string().pattern(/^[0-9]{6}$/).required().messages({
    "string.pattern.base": "Enter the 6-digit code.",
  }),
});

const resendOtpSchema = Joi.object({ email });

const loginSchema = Joi.object({
  email,
  password: Joi.string().required(),
});

const reviewSchema = Joi.object({
  status: Joi.string().valid("approved", "rejected").required(),
  note: Joi.string().trim().allow("").max(500).default(""),
});

module.exports = {
  signupSchema,
  verifyOtpSchema,
  resendOtpSchema,
  loginSchema,
  reviewSchema,
};
