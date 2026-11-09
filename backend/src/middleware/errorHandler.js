const config = require("../config/env");

function notFound(req, res) {
  res.status(404).json({
    success: false,
    data: null,
    error: { message: `Route not found: ${req.method} ${req.originalUrl}`, code: "NOT_FOUND" },
  });
}

function normalizeError(err) {
  if (err.name === "MulterError") {
    if (err.code === "LIMIT_FILE_SIZE") {
      return {
        status: 413,
        code: "FILE_TOO_LARGE",
        message: "Uploads must be 5 MB or smaller.",
      };
    }
    if (err.code === "LIMIT_UNEXPECTED_FILE") {
      return {
        status: 400,
        code: "UNEXPECTED_FILE",
        message: "Unexpected upload field.",
      };
    }
    return { status: 400, code: "UPLOAD_INVALID", message: "That upload could not be accepted." };
  }

  if (err.code === 11000) {
    const field = Object.keys(err.keyPattern || err.keyValue || {})[0] || "field";
    return {
      status: 409,
      code: field === "phone" ? "PHONE_TAKEN" : "EMAIL_TAKEN",
      message: `An account with that ${field} already exists.`,
      details: [{ field, message: `An account with that ${field} already exists.` }],
    };
  }

  if (err.name === "CastError" && err.kind === "ObjectId") {
    return { status: 400, code: "INVALID_ID", message: "That identifier is not valid." };
  }

  if (err.type === "entity.too.large") {
    return { status: 413, code: "PAYLOAD_TOO_LARGE", message: "That request is too large." };
  }

  return {
    status: err.status || err.statusCode || 500,
    code: err.code || ((err.status || err.statusCode) >= 500 ? "INTERNAL_ERROR" : "REQUEST_ERROR"),
    message: err.message,
    details: err.details,
    isOperational: Boolean(err.isOperational),
  };
}

// Central error handler. Always returns the same JSON envelope:
// { success, data, error }
function errorHandler(err, req, res, _next) {
  const normalized = normalizeError(err);
  const status = normalized.status;
  const isServerError = status >= 500;
  const exposeMessage = !isServerError || normalized.isOperational;

  if (isServerError && config.nodeEnv !== "test") {
    console.error("[error]", err);
  }

  res.status(status).json({
    success: false,
    data: null,
    error: {
      message: exposeMessage ? normalized.message : "Something went wrong on our side.",
      code: normalized.code,
      ...(normalized.details ? { details: normalized.details } : {}),
    },
  });
}

module.exports = { notFound, errorHandler };
