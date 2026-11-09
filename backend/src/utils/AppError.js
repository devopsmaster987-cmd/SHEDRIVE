class AppError extends Error {
  constructor(message, { status = 400, code = "REQUEST_ERROR", details = null } = {}) {
    super(message);
    this.name = "AppError";
    this.status = status;
    this.code = code;
    this.details = details;
    this.isOperational = true;
  }
}

module.exports = AppError;
