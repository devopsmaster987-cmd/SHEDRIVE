const AppError = require("../utils/AppError");

function validationError(error) {
  const details = error.details.map((item) => ({
    field: item.path.join("."),
    message: item.message.replace(/["]/g, ""),
  }));

  return new AppError("Please check the highlighted fields.", {
    status: 422,
    code: "VALIDATION_ERROR",
    details,
  });
}

function validator(schema, source) {
  return (req, _res, next) => {
    const { value, error } = schema.validate(req[source] || {}, {
      abortEarly: false,
      allowUnknown: false,
      stripUnknown: true,
      convert: true,
    });

    if (error) return next(validationError(error));

    req[source] = value;
    return next();
  };
}

function validateBody(schema) {
  return validator(schema, "body");
}

function validateQuery(schema) {
  return validator(schema, "query");
}

module.exports = { validateBody, validateQuery };
