const Joi = require("joi");

const phone = Joi.string()
  .trim()
  .pattern(/^\+?[0-9][0-9\s-]{6,18}$/)
  .messages({ "string.pattern.base": "Enter a valid phone number." });

const emergencyContactSchema = Joi.object({
  name: Joi.string().trim().min(2).max(80).required(),
  phone: phone.required(),
  relationship: Joi.string().trim().allow("").max(40).default(""),
});

const profileSchema = Joi.object({
  name: Joi.string().trim().min(2).max(80).required(),
  emergencyContacts: Joi.array().items(emergencyContactSchema).max(5).required(),
});

const coordinateSchema = Joi.object({
  lat: Joi.number().min(-90).max(90).required(),
  lng: Joi.number().min(-180).max(180).required(),
  label: Joi.string().trim().allow("").max(160).default(""),
});

const estimateSchema = Joi.object({
  pickup: coordinateSchema.required(),
  drop: coordinateSchema.required(),
  vehicleType: Joi.string().valid("Car", "Auto", "Bike").default("Car"),
});

const nearbyQuerySchema = Joi.object({
  lat: Joi.number().min(-90).max(90).required(),
  lng: Joi.number().min(-180).max(180).required(),
  radiusKm: Joi.number().min(1).max(25).default(5),
});

const driverStatusSchema = Joi.object({
  isOnline: Joi.boolean().required(),
});

const driverLocationSchema = Joi.object({
  lat: Joi.number().min(-90).max(90).required(),
  lng: Joi.number().min(-180).max(180).required(),
});

const createRideSchema = Joi.object({
  pickup: coordinateSchema.required(),
  drop: coordinateSchema.required(),
  vehicleType: Joi.string().valid("Car", "Auto", "Bike").default("Car"),
  offeredPrice: Joi.number().integer().min(20).max(10000).required(),
});

const createOfferSchema = Joi.object({
  offerPrice: Joi.number().integer().min(20).max(10000).required(),
  note: Joi.string().trim().allow("").max(80).default(""),
});

const rideStatusSchema = Joi.object({
  status: Joi.string().valid("arriving", "in_progress", "completed").required(),
});

const cancelRideSchema = Joi.object({
  reason: Joi.string().trim().allow("").max(160).default(""),
});

const rideListQuerySchema = Joi.object({
  limit: Joi.number().integer().min(1).max(50).default(20),
});

const walletTopupSchema = Joi.object({
  amount: Joi.number().integer().min(100).max(10000).required(),
});

const ridePaymentSchema = Joi.object({
  method: Joi.string().valid("cash", "wallet").required(),
});

const ratingSchema = Joi.object({
  stars: Joi.number().integer().min(1).max(5).required(),
  comment: Joi.string().trim().allow("").max(280).default(""),
});

const sosCreateSchema = Joi.object({
  rideId: Joi.string().trim().min(1).max(64).required(),
  lat: Joi.number().min(-90).max(90),
  lng: Joi.number().min(-180).max(180),
  message: Joi.string().trim().allow("").max(280).default(""),
}).with("lat", "lng");

const sosListQuerySchema = Joi.object({
  status: Joi.string().valid("open", "acknowledged", "resolved", "all").default("open"),
  page: Joi.number().integer().min(1).default(1),
  limit: Joi.number().integer().min(1).max(100).default(20),
});

const sosUpdateSchema = Joi.object({
  status: Joi.string().valid("acknowledged", "resolved").required(),
  note: Joi.string().trim().allow("").max(500).default(""),
});

const notificationListQuerySchema = Joi.object({
  limit: Joi.number().integer().min(1).max(50).default(20),
});

const adminUsersQuerySchema = Joi.object({
  role: Joi.string().valid("rider", "driver", "admin", "all").default("all"),
  status: Joi.string()
    .valid("active", "banned", "approved", "pending", "pending_review", "rejected", "all")
    .default("all"),
  search: Joi.string().trim().allow("").max(120).default(""),
  page: Joi.number().integer().min(1).default(1),
  limit: Joi.number().integer().min(1).max(100).default(20),
});

const driverDocListQuerySchema = Joi.object({
  status: Joi.string().valid("pending", "approved", "rejected", "all").default("pending"),
  page: Joi.number().integer().min(1).default(1),
  limit: Joi.number().integer().min(1).max(100).default(20),
});

const driverDocReviewSchema = Joi.object({
  status: Joi.string().valid("approved", "rejected").required(),
  note: Joi.string().trim().allow("").max(500).default(""),
});

const userAccessSchema = Joi.object({
  banned: Joi.boolean().required(),
  reason: Joi.string().trim().allow("").max(300).default(""),
});

module.exports = {
  profileSchema,
  estimateSchema,
  nearbyQuerySchema,
  driverStatusSchema,
  driverLocationSchema,
  createRideSchema,
  createOfferSchema,
  rideStatusSchema,
  cancelRideSchema,
  rideListQuerySchema,
  walletTopupSchema,
  ridePaymentSchema,
  ratingSchema,
  sosCreateSchema,
  sosListQuerySchema,
  sosUpdateSchema,
  notificationListQuerySchema,
  adminUsersQuerySchema,
  driverDocListQuerySchema,
  driverDocReviewSchema,
  userAccessSchema,
};
