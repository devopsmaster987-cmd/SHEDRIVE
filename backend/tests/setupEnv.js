process.env.NODE_ENV = "test";
process.env.JWT_SECRET = "test-only-jwt-secret-not-for-production";
process.env.OTP_PROVIDER = "mock";
process.env.BCRYPT_ROUNDS = "4";
process.env.FACE_SERVICE_URL = "http://face.invalid";
process.env.STORAGE_DIR = require("node:path").join(
  require("node:os").tmpdir(),
  "shedrive-test-storage"
);
