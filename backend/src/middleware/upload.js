const multer = require("multer");
const AppError = require("../utils/AppError");

const ALLOWED = {
  selfie: new Set(["image/jpeg", "image/png"]),
  licenseDoc: new Set(["image/jpeg", "image/png", "application/pdf"]),
};

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 5 * 1024 * 1024,
    files: 2,
    fields: 20,
    fieldSize: 512 * 1024,
  },
  fileFilter(_req, file, callback) {
    const allowed = ALLOWED[file.fieldname];
    if (!allowed) {
      return callback(
        new AppError("Unexpected upload field.", { status: 400, code: "UNEXPECTED_FILE" })
      );
    }
    if (!allowed.has(file.mimetype)) {
      return callback(
        new AppError(
          file.fieldname === "selfie"
            ? "Selfies must be JPEG or PNG."
            : "Licence documents must be PDF, JPEG or PNG.",
          { status: 415, code: "UNSUPPORTED_FILE_TYPE" }
        )
      );
    }
    return callback(null, true);
  },
});

const signupUpload = upload.fields([
  { name: "selfie", maxCount: 1 },
  { name: "licenseDoc", maxCount: 1 },
]);

module.exports = { signupUpload };
