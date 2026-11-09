const bcrypt = require("bcryptjs");
const config = require("../config/env");
const AppError = require("../utils/AppError");
const serializeUser = require("../utils/serializeUser");
const userRepository = require("../repositories/userRepository");
const otpRepository = require("../repositories/otpRepository");
const driverRepository = require("../repositories/driverRepository");
const reviewRepository = require("../repositories/reviewRepository");
const faceClient = require("../services/faceClient");
const storageService = require("../services/storageService");
const otpService = require("../services/otpService");
const { signAccessToken } = require("../services/tokenService");

function normalizePhone(phone) {
  const compact = String(phone || "").replace(/[\s-]/g, "");
  if (compact.startsWith("+")) return `+${compact.slice(1).replace(/\D/g, "")}`;
  return compact.replace(/\D/g, "");
}

function otpExpirySeconds() {
  return Math.round(config.otpExpiryMinutes * 60);
}

async function issueOtp(user) {
  const code = otpService.generateOtp();
  const expiresAt = new Date(Date.now() + config.otpExpiryMinutes * 60 * 1000);

  await otpRepository.deleteForUser(user._id);
  await otpRepository.create({
    user: user._id,
    codeHash: otpService.hashOtp(code),
    expiresAt,
    attempts: 0,
  });

  try {
    await otpService.sendOtp({ phone: user.phone, code });
  } catch (error) {
    await otpRepository.deleteForUser(user._id).catch(() => {});
    throw error;
  }
}

async function cleanupAccount(userId, { driverCreated, reviewCreated, licenseDocPath }) {
  if (!userId) return;
  await Promise.allSettled([
    otpRepository.deleteForUser(userId),
    reviewCreated ? reviewRepository.deleteByUser(userId) : Promise.resolve(),
    driverCreated ? driverRepository.deleteByUser(userId) : Promise.resolve(),
    userRepository.deleteById(userId),
  ]);
  if (licenseDocPath) {
    await storageService.removeLicenseDoc(licenseDocPath).catch(() => {});
  }
}

async function signup(req, res) {
  const selfie = req.files?.selfie?.[0];
  const licenseDoc = req.files?.licenseDoc?.[0];

  if (!selfie) {
    throw new AppError("Take or upload a selfie to continue.", {
      status: 422,
      code: "SELFIE_REQUIRED",
    });
  }

  if (req.body.role === "driver" && !licenseDoc) {
    throw new AppError("Upload your driving licence to sign up as a driver.", {
      status: 422,
      code: "LICENSE_DOCUMENT_REQUIRED",
    });
  }

  otpService.assertOtpProviderReady();

  const email = req.body.email.toLowerCase();
  const phone = normalizePhone(req.body.phone);

  if (!phone) {
    throw new AppError("Enter a valid phone number.", {
      status: 422,
      code: "VALIDATION_ERROR",
      details: [{ field: "phone", message: "Enter a valid phone number." }],
    });
  }

  const existing = await userRepository.exists({ email, phone });
  if (existing.email) {
    throw new AppError("An account with that email already exists.", {
      status: 409,
      code: "EMAIL_TAKEN",
      details: [{ field: "email", message: "An account with that email already exists." }],
    });
  }
  if (existing.phone) {
    throw new AppError("An account with that phone number already exists.", {
      status: 409,
      code: "PHONE_TAKEN",
      details: [{ field: "phone", message: "An account with that phone number already exists." }],
    });
  }

  const face = await faceClient.verifySelfie({
    buffer: selfie.buffer,
    mimetype: selfie.mimetype,
  });

  if (!face.available && face.invalid) {
    throw new AppError("We could not read that selfie. Please take another photo.", {
      status: 422,
      code: "INVALID_SELFIE",
    });
  }

  if (face.available && (face.decision === "no_face" || !face.faceDetected)) {
    throw new AppError("We could not find a face in that selfie. Please retake it in good light.", {
      status: 422,
      code: "FACE_NOT_DETECTED",
    });
  }

  const autoApproved = face.available && face.decision === "auto_approved";
  const verificationStatus = autoApproved ? "approved" : "pending_review";
  const passwordHash = await bcrypt.hash(req.body.password, config.bcryptRounds);

  let user = null;
  let driverCreated = false;
  let reviewCreated = false;
  let licenseDocPath = null;

  try {
    user = await userRepository.create({
      name: req.body.name,
      email,
      phone,
      passwordHash,
      role: req.body.role,
      faceEmbedding: face.available ? face.embedding : [],
      verificationStatus,
    });

    let licenseDocUrl = null;

    if (req.body.role === "driver") {
      const storedDoc = await storageService.saveLicenseDoc(licenseDoc);
      licenseDocPath = storedDoc.path;
      licenseDocUrl = storedDoc.url;

      await driverRepository.create({
        user: user._id,
        vehicleType: req.body.vehicleType,
        plateNumber: req.body.plateNumber,
        licenseDocUrl,
      });
      driverCreated = true;
    }

    if (!autoApproved) {
      const prediction =
        face.available && ["female", "male"].includes(face.gender) ? face.gender : "unknown";
      await reviewRepository.create({
        user: user._id,
        faceConfidenceScore: face.available ? face.confidence : 0,
        facePrediction: face.available ? prediction : null,
        faceDecision: face.available ? face.decision : "unavailable",
        submittedDocs: licenseDocUrl ? [licenseDocUrl] : [],
        note: face.available
          ? ""
          : "Automatic verification was unavailable. Please review this account manually.",
      });
      reviewCreated = true;
    }

    await issueOtp(user);
  } catch (error) {
    await cleanupAccount(user?._id, { driverCreated, reviewCreated, licenseDocPath });
    throw error;
  }

  res.status(201).json({
    success: true,
    data: {
      user: serializeUser(user),
      phoneVerificationRequired: true,
      otpExpiresInSeconds: otpExpirySeconds(),
      reviewRequired: !autoApproved,
    },
    error: null,
  });
}

async function verifyOtp(req, res) {
  const { email, otp } = req.body;
  const user = await userRepository.findByEmail(email);

  if (!user) {
    throw new AppError("That code is not valid. Request a new one and try again.", {
      status: 400,
      code: "OTP_INVALID",
    });
  }

  if (user.phoneVerified) {
    throw new AppError("Your phone is already verified. Please log in.", {
      status: 409,
      code: "PHONE_ALREADY_VERIFIED",
    });
  }

  const record = await otpRepository.findLatestForUser(user._id);
  if (!record) {
    throw new AppError("That code has expired. Request a new one.", {
      status: 410,
      code: "OTP_EXPIRED",
    });
  }

  if (new Date(record.expiresAt).getTime() <= Date.now()) {
    await otpRepository.deleteForUser(user._id);
    throw new AppError("That code has expired. Request a new one.", {
      status: 410,
      code: "OTP_EXPIRED",
    });
  }

  if (!otpService.otpMatches(otp, record.codeHash)) {
    const attempts = (record.attempts || 0) + 1;
    if (attempts >= config.otpMaxAttempts) {
      await otpRepository.deleteForUser(user._id);
      throw new AppError("Too many incorrect codes. Request a new one.", {
        status: 429,
        code: "OTP_LOCKED",
      });
    }
    await otpRepository.incrementAttempts(record);
    throw new AppError("That code is not valid. Check it and try again.", {
      status: 400,
      code: "OTP_INVALID",
    });
  }

  await otpRepository.deleteForUser(user._id);
  const updated = await userRepository.updateById(user._id, { phoneVerified: true });
  const verifiedUser = updated || { ...user, phoneVerified: true };
  const token = signAccessToken(verifiedUser);

  res.json({
    success: true,
    data: { token, user: serializeUser(verifiedUser) },
    error: null,
  });
}

async function resendOtp(req, res) {
  otpService.assertOtpProviderReady();

  const user = await userRepository.findByEmail(req.body.email);
  if (user && !user.phoneVerified) {
    await issueOtp(user);
  }

  res.status(202).json({
    success: true,
    data: { sent: true, otpExpiresInSeconds: otpExpirySeconds() },
    error: null,
  });
}

async function login(req, res) {
  const user = await userRepository.findByEmail(req.body.email, { withPassword: true });
  const invalid = new AppError("Email or password is incorrect.", {
    status: 401,
    code: "INVALID_CREDENTIALS",
  });

  if (!user) throw invalid;

  const passwordOk = await bcrypt.compare(req.body.password, user.passwordHash || "");
  if (!passwordOk) throw invalid;

  if (user.isBanned) {
    throw new AppError("This account is suspended. Please contact support.", {
      status: 403,
      code: "ACCOUNT_SUSPENDED",
    });
  }

  if (!user.phoneVerified) {
    throw new AppError("Verify your phone number to log in.", {
      status: 403,
      code: "PHONE_NOT_VERIFIED",
      details: [{ field: "email", message: user.email }],
    });
  }

  const token = signAccessToken(user);

  res.json({
    success: true,
    data: { token, user: serializeUser(user) },
    error: null,
  });
}

async function me(req, res) {
  res.json({ success: true, data: { user: serializeUser(req.user) }, error: null });
}

module.exports = { signup, verifyOtp, resendOtp, login, me };
