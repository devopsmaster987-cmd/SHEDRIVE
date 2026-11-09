const request = require("supertest");
const bcrypt = require("bcryptjs");
const app = require("../src/app");
const userRepository = require("../src/repositories/userRepository");
const otpRepository = require("../src/repositories/otpRepository");
const driverRepository = require("../src/repositories/driverRepository");
const reviewRepository = require("../src/repositories/reviewRepository");
const faceClient = require("../src/services/faceClient");
const storageService = require("../src/services/storageService");
const otpService = require("../src/services/otpService");
const { signAccessToken } = require("../src/services/tokenService");

jest.mock("../src/repositories/userRepository", () => ({
  exists: jest.fn(),
  create: jest.fn(),
  findByEmail: jest.fn(),
  findById: jest.fn(),
  updateById: jest.fn(),
  deleteById: jest.fn(),
}));

jest.mock("../src/repositories/otpRepository", () => ({
  create: jest.fn(),
  findLatestForUser: jest.fn(),
  incrementAttempts: jest.fn(),
  deleteForUser: jest.fn(),
}));

jest.mock("../src/repositories/driverRepository", () => ({
  create: jest.fn(),
  deleteByUser: jest.fn(),
  findByUser: jest.fn(),
}));

jest.mock("../src/repositories/reviewRepository", () => ({
  create: jest.fn(),
  deleteByUser: jest.fn(),
  list: jest.fn(),
  findById: jest.fn(),
  update: jest.fn(),
  findByUser: jest.fn(),
}));

jest.mock("../src/services/faceClient", () => ({ verifySelfie: jest.fn() }));

jest.mock("../src/services/storageService", () => ({
  saveLicenseDoc: jest.fn(),
  readLicenseDoc: jest.fn(),
  removeLicenseDoc: jest.fn(),
}));

jest.mock("../src/services/otpService", () => {
  const actual = jest.requireActual("../src/services/otpService");
  return { ...actual, sendOtp: jest.fn() };
});

const SELFIE = Buffer.from("not-a-real-jpeg");
const OTP = "123456";

function makeUser(overrides = {}) {
  return {
    _id: "user-1",
    name: "Aisha Khan",
    email: "aisha@example.com",
    phone: "+919876543210",
    role: "rider",
    verificationStatus: "approved",
    phoneVerified: true,
    emergencyContacts: [],
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    ...overrides,
  };
}

function signupRequest() {
  return request(app)
    .post("/api/auth/signup")
    .field("name", "Aisha Khan")
    .field("email", "aisha@example.com")
    .field("phone", "+919876543210")
    .field("password", "secret123")
    .field("role", "rider")
    .attach("selfie", SELFIE, { filename: "selfie.jpg", contentType: "image/jpeg" });
}

beforeEach(() => {
  jest.resetAllMocks();

  userRepository.exists.mockResolvedValue({ email: false, phone: false });
  userRepository.create.mockImplementation(async (data) => ({ ...makeUser(), ...data }));
  userRepository.deleteById.mockResolvedValue({});
  userRepository.findById.mockResolvedValue(makeUser());
  userRepository.updateById.mockImplementation(async (id, updates) => ({ ...makeUser(), ...updates }));

  otpRepository.create.mockResolvedValue({});
  otpRepository.deleteForUser.mockResolvedValue({});
  otpRepository.findLatestForUser.mockResolvedValue(null);
  otpRepository.incrementAttempts.mockResolvedValue({});

  driverRepository.create.mockResolvedValue({});
  driverRepository.deleteByUser.mockResolvedValue({});

  reviewRepository.create.mockResolvedValue({});
  reviewRepository.deleteByUser.mockResolvedValue({});
  reviewRepository.list.mockResolvedValue({ items: [], total: 0 });

  storageService.saveLicenseDoc.mockResolvedValue({
    path: "/tmp/shedrive/license-docs/11111111-1111-4111-8111-111111111111.pdf",
    url: "/api/admin/driver-documents/11111111-1111-4111-8111-111111111111.pdf",
  });
  storageService.readLicenseDoc.mockResolvedValue({
    buffer: Buffer.from("%PDF-1.4"),
    contentType: "application/pdf",
    filename: "11111111-1111-4111-8111-111111111111.pdf",
  });
  storageService.removeLicenseDoc.mockResolvedValue();

  otpService.sendOtp.mockResolvedValue();

  faceClient.verifySelfie.mockResolvedValue({
    available: true,
    faceDetected: true,
    gender: "female",
    confidence: 0.97,
    decision: "auto_approved",
    embedding: Array.from({ length: 512 }, () => 0.1),
  });
});

describe("POST /api/auth/signup", () => {
  test("auto-approves a female selfie and sends an OTP without issuing a token", async () => {
    const res = await signupRequest().expect(201);

    expect(res.body.success).toBe(true);
    expect(res.body.data.user.verificationStatus).toBe("approved");
    expect(res.body.data.phoneVerificationRequired).toBe(true);
    expect(res.body.data.reviewRequired).toBe(false);
    expect(res.body.data.token).toBeUndefined();
    expect(res.body.data.user.passwordHash).toBeUndefined();
    expect(res.body.data.user.faceEmbedding).toBeUndefined();
    expect(userRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({
        email: "aisha@example.com",
        role: "rider",
        verificationStatus: "approved",
      })
    );
    expect(reviewRepository.create).not.toHaveBeenCalled();
    expect(otpRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({ user: "user-1", attempts: 0 })
    );
    expect(otpService.sendOtp).toHaveBeenCalledWith(
      expect.objectContaining({ phone: "+919876543210" })
    );
  });

  test("rejects a selfie where no face is detected", async () => {
    faceClient.verifySelfie.mockResolvedValue({
      available: true,
      faceDetected: false,
      gender: "unknown",
      confidence: 0,
      decision: "no_face",
      embedding: [],
    });

    const res = await signupRequest().expect(422);

    expect(res.body.error.code).toBe("FACE_NOT_DETECTED");
    expect(userRepository.create).not.toHaveBeenCalled();
    expect(otpService.sendOtp).not.toHaveBeenCalled();
  });

  test("queues manual review when the face service is unavailable", async () => {
    faceClient.verifySelfie.mockResolvedValue({
      available: false,
      invalid: false,
      reason: "face_service_unreachable",
    });

    const res = await signupRequest().expect(201);

    expect(res.body.data.user.verificationStatus).toBe("pending_review");
    expect(res.body.data.reviewRequired).toBe(true);
    expect(reviewRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({
        user: "user-1",
        faceDecision: "unavailable",
        facePrediction: null,
        faceConfidenceScore: 0,
      })
    );
  });

  test("queues manual review when the face service asks for a human", async () => {
    faceClient.verifySelfie.mockResolvedValue({
      available: true,
      faceDetected: true,
      gender: "male",
      confidence: 0.72,
      decision: "needs_review",
      embedding: Array.from({ length: 512 }, () => 0.2),
    });

    const res = await signupRequest().expect(201);

    expect(res.body.data.user.verificationStatus).toBe("pending_review");
    expect(reviewRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({
        faceDecision: "needs_review",
        facePrediction: "male",
        faceConfidenceScore: 0.72,
      })
    );
  });

  test("rejects a driver signup without a licence document before calling the face service", async () => {
    const res = await request(app)
      .post("/api/auth/signup")
      .field("name", "Aisha Khan")
      .field("email", "aisha@example.com")
      .field("phone", "+919876543210")
      .field("password", "secret123")
      .field("role", "driver")
      .field("vehicleType", "Car")
      .field("plateNumber", "KA01AB1234")
      .attach("selfie", SELFIE, { filename: "selfie.jpg", contentType: "image/jpeg" })
      .expect(422);

    expect(res.body.error.code).toBe("LICENSE_DOCUMENT_REQUIRED");
    expect(faceClient.verifySelfie).not.toHaveBeenCalled();
    expect(userRepository.create).not.toHaveBeenCalled();
  });

  test("stores a driver licence privately and creates driver details", async () => {
    const res = await request(app)
      .post("/api/auth/signup")
      .field("name", "Aisha Khan")
      .field("email", "aisha@example.com")
      .field("phone", "+919876543210")
      .field("password", "secret123")
      .field("role", "driver")
      .field("vehicleType", "Car")
      .field("plateNumber", "KA01AB1234")
      .attach("selfie", SELFIE, { filename: "selfie.jpg", contentType: "image/jpeg" })
      .attach("licenseDoc", Buffer.from("%PDF-1.4"), {
        filename: "licence.pdf",
        contentType: "application/pdf",
      })
      .expect(201);

    expect(res.body.data.user.role).toBe("driver");
    expect(storageService.saveLicenseDoc).toHaveBeenCalled();
    expect(driverRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({
        user: "user-1",
        vehicleType: "Car",
        plateNumber: "KA01AB1234",
        licenseDocUrl:
          "/api/admin/driver-documents/11111111-1111-4111-8111-111111111111.pdf",
      })
    );
  });

  test("returns 409 when the email already exists", async () => {
    userRepository.exists.mockResolvedValue({ email: true, phone: false });

    const res = await signupRequest().expect(409);

    expect(res.body.error.code).toBe("EMAIL_TAKEN");
    expect(faceClient.verifySelfie).not.toHaveBeenCalled();
    expect(userRepository.create).not.toHaveBeenCalled();
  });

  test("rejects unsupported selfie file types", async () => {
    const res = await request(app)
      .post("/api/auth/signup")
      .field("name", "Aisha Khan")
      .field("email", "aisha@example.com")
      .field("phone", "+919876543210")
      .field("password", "secret123")
      .field("role", "rider")
      .attach("selfie", SELFIE, { filename: "selfie.gif", contentType: "image/gif" })
      .expect(415);

    expect(res.body.error.code).toBe("UNSUPPORTED_FILE_TYPE");
  });
});

describe("POST /api/auth/verify-otp", () => {
  test("verifies a correct OTP, marks the phone verified, and returns a token", async () => {
    const user = makeUser({ phoneVerified: false, verificationStatus: "pending_review" });
    userRepository.findByEmail.mockResolvedValue(user);
    otpRepository.findLatestForUser.mockResolvedValue({
      user: user._id,
      codeHash: otpService.hashOtp(OTP),
      expiresAt: new Date(Date.now() + 60_000),
      attempts: 0,
    });
    userRepository.updateById.mockResolvedValue({ ...user, phoneVerified: true });

    const res = await request(app)
      .post("/api/auth/verify-otp")
      .send({ email: user.email, otp: OTP })
      .expect(200);

    expect(res.body.data.token).toEqual(expect.any(String));
    expect(res.body.data.user.phoneVerified).toBe(true);
    expect(otpRepository.deleteForUser).toHaveBeenCalledWith(user._id);
  });

  test("increments attempts for an incorrect OTP", async () => {
    const user = makeUser({ phoneVerified: false });
    const record = {
      user: user._id,
      codeHash: otpService.hashOtp(OTP),
      expiresAt: new Date(Date.now() + 60_000),
      attempts: 1,
    };
    userRepository.findByEmail.mockResolvedValue(user);
    otpRepository.findLatestForUser.mockResolvedValue(record);

    const res = await request(app)
      .post("/api/auth/verify-otp")
      .send({ email: user.email, otp: "000000" })
      .expect(400);

    expect(res.body.error.code).toBe("OTP_INVALID");
    expect(otpRepository.incrementAttempts).toHaveBeenCalledWith(record);
  });

  test("locks the OTP after the maximum number of attempts", async () => {
    const user = makeUser({ phoneVerified: false });
    userRepository.findByEmail.mockResolvedValue(user);
    otpRepository.findLatestForUser.mockResolvedValue({
      user: user._id,
      codeHash: otpService.hashOtp(OTP),
      expiresAt: new Date(Date.now() + 60_000),
      attempts: 4,
    });

    const res = await request(app)
      .post("/api/auth/verify-otp")
      .send({ email: user.email, otp: "000000" })
      .expect(429);

    expect(res.body.error.code).toBe("OTP_LOCKED");
    expect(otpRepository.deleteForUser).toHaveBeenCalledWith(user._id);
    expect(otpRepository.incrementAttempts).not.toHaveBeenCalled();
  });

  test("rejects an expired OTP", async () => {
    const user = makeUser({ phoneVerified: false });
    userRepository.findByEmail.mockResolvedValue(user);
    otpRepository.findLatestForUser.mockResolvedValue({
      user: user._id,
      codeHash: otpService.hashOtp(OTP),
      expiresAt: new Date(Date.now() - 1000),
      attempts: 0,
    });

    const res = await request(app)
      .post("/api/auth/verify-otp")
      .send({ email: user.email, otp: OTP })
      .expect(410);

    expect(res.body.error.code).toBe("OTP_EXPIRED");
  });
});

describe("POST /api/auth/resend-otp", () => {
  test("issues a fresh code for an unverified account", async () => {
    const user = makeUser({ phoneVerified: false, verificationStatus: "pending_review" });
    userRepository.findByEmail.mockResolvedValue(user);

    const res = await request(app)
      .post("/api/auth/resend-otp")
      .send({ email: user.email })
      .expect(202);

    expect(res.body.data.sent).toBe(true);
    expect(otpRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({ user: user._id })
    );
    expect(otpService.sendOtp).toHaveBeenCalledWith(
      expect.objectContaining({ phone: user.phone })
    );
  });

  test("returns the same response for an unknown email without sending", async () => {
    userRepository.findByEmail.mockResolvedValue(null);

    const res = await request(app)
      .post("/api/auth/resend-otp")
      .send({ email: "nobody@example.com" })
      .expect(202);

    expect(res.body.data.sent).toBe(true);
    expect(otpRepository.create).not.toHaveBeenCalled();
    expect(otpService.sendOtp).not.toHaveBeenCalled();
  });
});

describe("POST /api/auth/login", () => {
  test("logs in a verified user and returns a token", async () => {
    const passwordHash = await bcrypt.hash("secret123", 4);
    userRepository.findByEmail.mockResolvedValue(makeUser({ passwordHash }));

    const res = await request(app)
      .post("/api/auth/login")
      .send({ email: "aisha@example.com", password: "secret123" })
      .expect(200);

    expect(res.body.data.token).toEqual(expect.any(String));
    expect(res.body.data.user.email).toBe("aisha@example.com");
  });

  test("blocks login until the phone is verified", async () => {
    const passwordHash = await bcrypt.hash("secret123", 4);
    userRepository.findByEmail.mockResolvedValue(
      makeUser({ passwordHash, phoneVerified: false })
    );

    const res = await request(app)
      .post("/api/auth/login")
      .send({ email: "aisha@example.com", password: "secret123" })
      .expect(403);

    expect(res.body.error.code).toBe("PHONE_NOT_VERIFIED");
  });

  test("returns a generic error for bad credentials", async () => {
    userRepository.findByEmail.mockResolvedValue(makeUser());

    const res = await request(app)
      .post("/api/auth/login")
      .send({ email: "aisha@example.com", password: "wrong-password" })
      .expect(401);

    expect(res.body.error.code).toBe("INVALID_CREDENTIALS");
  });
});

describe("GET /api/auth/me", () => {
  test("returns the current user for a valid token", async () => {
    const user = makeUser();
    userRepository.findById.mockResolvedValue(user);

    const res = await request(app)
      .get("/api/auth/me")
      .set("Authorization", `Bearer ${signAccessToken(user)}`)
      .expect(200);

    expect(res.body.data.user.id).toBe("user-1");
    expect(res.body.data.user.email).toBe("aisha@example.com");
  });

  test("rejects requests without a token", async () => {
    const res = await request(app).get("/api/auth/me").expect(401);
    expect(res.body.error.code).toBe("AUTH_REQUIRED");
  });
});

describe("admin review queue", () => {
  function adminToken() {
    return signAccessToken(makeUser({ _id: "admin-1", role: "admin" }));
  }

  test("lists pending reviews for an admin", async () => {
    userRepository.findById.mockResolvedValue(makeUser({ _id: "admin-1", role: "admin" }));
    reviewRepository.list.mockResolvedValue({ items: [{ _id: "review-1" }], total: 1 });

    const res = await request(app)
      .get("/api/admin/review-queue")
      .set("Authorization", `Bearer ${adminToken()}`)
      .expect(200);

    expect(res.body.data.total).toBe(1);
    expect(reviewRepository.list).toHaveBeenCalledWith({ status: "pending", page: 1, limit: 20 });
  });

  test("blocks non-admin users", async () => {
    const res = await request(app)
      .get("/api/admin/review-queue")
      .set("Authorization", `Bearer ${signAccessToken(makeUser())}`)
      .expect(403);

    expect(res.body.error.code).toBe("FORBIDDEN");
  });

  test("approves a pending review and updates the user", async () => {
    const review = { _id: "review-1", user: "user-1", status: "pending", note: "" };
    reviewRepository.findById.mockResolvedValue(review);
    reviewRepository.update.mockImplementation(async (record, updates) => ({
      ...record,
      ...updates,
    }));
    userRepository.findById.mockResolvedValue(makeUser({ _id: "admin-1", role: "admin" }));
    userRepository.updateById.mockResolvedValue(makeUser({ verificationStatus: "approved" }));

    const res = await request(app)
      .patch("/api/admin/review-queue/review-1")
      .set("Authorization", `Bearer ${adminToken()}`)
      .send({ status: "approved", note: "Verified manually." })
      .expect(200);

    expect(res.body.data.review.status).toBe("approved");
    expect(res.body.data.user.verificationStatus).toBe("approved");
    expect(userRepository.updateById).toHaveBeenCalledWith("user-1", {
      verificationStatus: "approved",
    });
    expect(reviewRepository.update).toHaveBeenCalledWith(
      review,
      expect.objectContaining({ status: "approved", note: "Verified manually." })
    );
  });

  test("serves a private driver licence document to admins", async () => {
    userRepository.findById.mockResolvedValue(makeUser({ _id: "admin-1", role: "admin" }));

    const res = await request(app)
      .get("/api/admin/driver-documents/11111111-1111-4111-8111-111111111111.pdf")
      .set("Authorization", `Bearer ${adminToken()}`)
      .expect(200);

    expect(res.headers["content-type"]).toContain("application/pdf");
    expect(res.headers["cache-control"]).toBe("private, no-store");
    expect(res.headers["content-disposition"]).toContain("inline");
    expect(storageService.readLicenseDoc).toHaveBeenCalledWith(
      "11111111-1111-4111-8111-111111111111.pdf"
    );
  });

  test("does not allow reviewing an entry twice", async () => {
    reviewRepository.findById.mockResolvedValue({
      _id: "review-1",
      user: "user-1",
      status: "approved",
    });
    userRepository.findById.mockResolvedValue(makeUser({ _id: "admin-1", role: "admin" }));

    const res = await request(app)
      .patch("/api/admin/review-queue/review-1")
      .set("Authorization", `Bearer ${adminToken()}`)
      .send({ status: "rejected" })
      .expect(409);

    expect(res.body.error.code).toBe("ALREADY_REVIEWED");
  });
});
