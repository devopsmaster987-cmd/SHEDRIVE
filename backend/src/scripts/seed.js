require("../../dns-fix.cjs");
const bcrypt = require("bcryptjs");
const mongoose = require("mongoose");
const fs = require("node:fs/promises");
const path = require("node:path");
const config = require("../config/env");
const User = require("../models/User");
const DriverDetails = require("../models/DriverDetails");
const Ride = require("../models/Ride");
const WalletTransaction = require("../models/WalletTransaction");
const AdminReviewQueue = require("../models/AdminReviewQueue");
const SOSAlert = require("../models/SOSAlert");
const Notification = require("../models/Notification");

const ADMIN_EMAIL = (process.env.ADMIN_EMAIL || "admin@shedrive.test").toLowerCase();
const ADMIN_PHONE = process.env.ADMIN_PHONE || "+910000000001";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "Admin@12345";

const DEMO_REVIEW_EMAIL = (process.env.DEMO_REVIEW_EMAIL || "review@shedrive.test").toLowerCase();
const DEMO_REVIEW_PHONE = process.env.DEMO_REVIEW_PHONE || "+910000000002";
const DEMO_REVIEW_PASSWORD = process.env.DEMO_REVIEW_PASSWORD || "Review@12345";

const RIDER_EMAIL = (process.env.DEMO_RIDER_EMAIL || "rider@shedrive.test").toLowerCase();
const RIDER_PHONE = process.env.DEMO_RIDER_PHONE || "+910000000003";
const RIDER_PASSWORD = process.env.DEMO_RIDER_PASSWORD || "Rider@12345";

const DRIVER_EMAIL = (process.env.DEMO_DRIVER_EMAIL || "driver@shedrive.test").toLowerCase();
const DRIVER_PHONE = (process.env.DEMO_DRIVER_PHONE || "+910000000004").toLowerCase();
const DRIVER_PASSWORD = process.env.DEMO_DRIVER_PASSWORD || "Driver@12345";

const EXTRA_DRIVERS = [
  {
    name: "Meera Rao",
    email: "driver2@shedrive.test",
    phone: "+910000000005",
    vehicleType: "Auto",
    plateNumber: "KA02CD5678",
    ratingAvg: 4.86,
    isOnline: true,
    location: [77.6245, 12.9352],
    licenseDoc: "11111111-1111-4111-8111-111111111111.pdf",
  },
  {
    name: "Tara Singh",
    email: "driver3@shedrive.test",
    phone: "+910000000006",
    vehicleType: "Bike",
    plateNumber: "KA03EF9012",
    ratingAvg: 4.78,
    isOnline: false,
    location: [77.5801, 12.98],
    licenseDoc: "22222222-2222-4222-8222-222222222222.pdf",
  },
];

const DEMO_PASSWORD = "Driver@12345";
const DEMO_LICENSE = "%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF\n";

async function ensureUser({ name, email, phone, password, role, verificationStatus, emergencyContacts = [] }) {
  let user = await User.findOne({ email });
  if (user) return user;

  user = await User.create({
    name,
    email,
    phone,
    passwordHash: await bcrypt.hash(password, config.bcryptRounds),
    role,
    verificationStatus,
    phoneVerified: true,
    emergencyContacts,
  });

  console.info(`[seed] ${role} created: ${email}`);
  if (!config.isProduction) console.info(`[seed] demo password: ${password}`);
  return user;
}

async function ensureLicenseDoc(filename) {
  const directory = path.join(config.storageDir, "license-docs");
  await fs.mkdir(directory, { recursive: true, mode: 0o700 });
  const fullPath = path.join(directory, filename);
  await fs.writeFile(fullPath, DEMO_LICENSE, { mode: 0o600 });
  return `/api/admin/driver-documents/${filename}`;
}

async function seedAdmin() {
  const admin = await User.findOne({ email: ADMIN_EMAIL });
  if (admin) {
    console.info(`[seed] admin already exists: ${ADMIN_EMAIL}`);
    return admin;
  }

  const created = await User.create({
    name: "SheDrive Admin",
    email: ADMIN_EMAIL,
    phone: ADMIN_PHONE,
    passwordHash: await bcrypt.hash(ADMIN_PASSWORD, config.bcryptRounds),
    role: "admin",
    verificationStatus: "approved",
    phoneVerified: true,
  });

  console.info(`[seed] admin created: ${ADMIN_EMAIL}`);
  if (!config.isProduction) console.info(`[seed] demo admin password: ${ADMIN_PASSWORD}`);
  return created;
}

async function seedDemoReview() {
  let pending = await User.findOne({ email: DEMO_REVIEW_EMAIL });
  if (!pending) {
    pending = await User.create({
      name: "Demo Review Rider",
      email: DEMO_REVIEW_EMAIL,
      phone: DEMO_REVIEW_PHONE,
      passwordHash: await bcrypt.hash(DEMO_REVIEW_PASSWORD, config.bcryptRounds),
      role: "rider",
      verificationStatus: "pending_review",
      phoneVerified: true,
      faceEmbedding: Array.from({ length: 512 }, () => 0),
    });
    console.info(`[seed] demo review rider created: ${DEMO_REVIEW_EMAIL}`);
    if (!config.isProduction) console.info(`[seed] demo review password: ${DEMO_REVIEW_PASSWORD}`);
  }

  await AdminReviewQueue.findOneAndUpdate(
    { user: pending._id },
    {
      $setOnInsert: {
        faceConfidenceScore: 0.72,
        facePrediction: "male",
        faceDecision: "needs_review",
        submittedDocs: [],
        status: "pending",
        note: "Seeded demo review item.",
      },
    },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );

  console.info("[seed] pending review queue item ready");
}

async function seedRider() {
  return ensureUser({
    name: "Aisha Khan",
    email: RIDER_EMAIL,
    phone: RIDER_PHONE,
    password: RIDER_PASSWORD,
    role: "rider",
    verificationStatus: "approved",
    emergencyContacts: [
      { name: "Maya Khan", phone: "+910000000010", relationship: "Sister" },
      { name: "Noor Khan", phone: "+910000000011", relationship: "Friend" },
    ],
  });
}

async function seedWallet(rider) {
  const reference = "TOP-SEED-DEMO";
  const existing = await WalletTransaction.findOne({ reference });
  if (existing) {
    console.info("[seed] demo wallet already exists");
    return;
  }

  const amount = 1500;
  const updated = await User.findByIdAndUpdate(
    rider._id,
    { $set: { walletBalance: amount } },
    { new: true, runValidators: true }
  );

  await WalletTransaction.create({
    user: rider._id,
    type: "topup",
    amount,
    balanceAfter: updated?.walletBalance ?? amount,
    description: "Demo wallet top-up",
    reference,
  });

  console.info("[seed] demo wallet funded");
}

async function seedDrivers() {
  const primary = await ensureUser({
    name: "Sana Iqbal",
    email: DRIVER_EMAIL,
    phone: DRIVER_PHONE,
    password: DRIVER_PASSWORD,
    role: "driver",
    verificationStatus: "approved",
  });

  const primaryLicense = await ensureLicenseDoc("00000000-0000-4000-8000-000000000001.pdf");
  const primaryDetails = {
    user: primary._id,
    vehicleType: "Car",
    plateNumber: "KA01AB1234",
    licenseDocUrl: primaryLicense,
    licenseDocStatus: "approved",
    ratingAvg: 4.92,
    isOnline: false,
    currentLocation: { type: "Point", coordinates: [77.5946, 12.9716] },
  };

  await DriverDetails.findOneAndUpdate(
    { user: primary._id },
    { $setOnInsert: primaryDetails },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );

  const extras = [];
  for (const driver of EXTRA_DRIVERS) {
    const user = await ensureUser({
      name: driver.name,
      email: driver.email,
      phone: driver.phone,
      password: DEMO_PASSWORD,
      role: "driver",
      verificationStatus: "approved",
    });

    const licenseUrl = await ensureLicenseDoc(driver.licenseDoc);
    await DriverDetails.findOneAndUpdate(
      { user: user._id },
      {
        $setOnInsert: {
          user: user._id,
          vehicleType: driver.vehicleType,
          plateNumber: driver.plateNumber,
          licenseDocUrl: licenseUrl,
          licenseDocStatus: "approved",
          ratingAvg: driver.ratingAvg,
          isOnline: driver.isOnline,
          currentLocation: { type: "Point", coordinates: driver.location },
        },
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );
    extras.push(user);
  }

  console.info("[seed] demo drivers ready");
  return { primary, extras };
}

async function seedRides(rider, driver) {
  const existing = await Ride.countDocuments({ rider: rider._id, driver: driver._id });
  if (existing > 0) {
    console.info("[seed] demo rides already exist");
    return;
  }

  const now = Date.now();
  const rides = [
    {
      pickup: [77.5946, 12.9716],
      drop: [77.6245, 12.9352],
      pickupLabel: "MG Road",
      dropLabel: "Indiranagar",
      distanceKm: 7.4,
      offeredPrice: 120,
      finalPrice: 130,
      completedAt: new Date(now - 2 * 60 * 60 * 1000),
    },
    {
      pickup: [77.5801, 12.98],
      drop: [77.5946, 12.9716],
      pickupLabel: "Koramangala",
      dropLabel: "MG Road",
      distanceKm: 4.1,
      offeredPrice: 90,
      finalPrice: 90,
      completedAt: new Date(now - 27 * 60 * 60 * 1000),
    },
    {
      pickup: [77.5946, 12.9716],
      drop: [77.6546, 12.9716],
      pickupLabel: "MG Road",
      dropLabel: "Indiranagar",
      distanceKm: 8.2,
      offeredPrice: 150,
      finalPrice: 160,
      completedAt: new Date(now - 9 * 24 * 60 * 60 * 1000),
    },
  ];

  await Ride.create(
    rides.map((ride) => ({
      rider: rider._id,
      driver: driver._id,
      pickup: { type: "Point", coordinates: ride.pickup },
      drop: { type: "Point", coordinates: ride.drop },
      pickupLabel: ride.pickupLabel,
      dropLabel: ride.dropLabel,
      vehicleType: "Car",
      distanceKm: ride.distanceKm,
      durationMinutes: Math.round(ride.distanceKm * 2.4 + 2),
      offeredPrice: ride.offeredPrice,
      finalPrice: ride.finalPrice,
      status: "completed",
      completedAt: ride.completedAt,
    }))
  );

  console.info("[seed] demo completed rides created");
}

async function seedSafetyHistory(rider) {
  const ride = await Ride.findOne({ rider: rider._id, status: "completed" }).sort({
    completedAt: -1,
  });
  if (!ride) return;

  let alert = await SOSAlert.findOne({ user: rider._id, note: "Seeded demo alert." });
  if (!alert) {
    alert = await SOSAlert.create({
      ride: ride._id,
      user: rider._id,
      location: ride.pickup,
      raisedAt: new Date(Date.now() - 6 * 24 * 60 * 60 * 1000),
      status: "resolved",
      message: "Demo safety drill. No emergency.",
      note: "Seeded demo alert.",
      contactsNotified: rider.emergencyContacts.length,
      acknowledgedAt: new Date(Date.now() - 6 * 24 * 60 * 60 * 1000 + 60 * 1000),
      resolvedAt: new Date(Date.now() - 6 * 24 * 60 * 60 * 1000 + 5 * 60 * 1000),
    });
    console.info("[seed] demo safety history ready");
  }

  const existing = await Notification.findOne({ user: rider._id, type: "sos" });
  if (!existing) {
    await Notification.create({
      user: rider._id,
      type: "sos",
      title: "Your demo SOS alert is resolved",
      message: "This seeded drill shows how safety-desk updates appear in your notification feed.",
      ride: ride._id,
      sosAlert: alert._id,
      readStatus: true,
      readAt: new Date(),
    });
  }
}

async function main() {
  await mongoose.connect(config.mongoUri);
  await seedAdmin();
  await seedDemoReview();
  const rider = await seedRider();
  await seedWallet(rider);
  const drivers = await seedDrivers();
  await seedRides(rider, drivers.primary);
  await seedSafetyHistory(rider);
  await mongoose.disconnect();
  console.info("[seed] done");
}

main().catch(async (error) => {
  console.error("[seed] failed", error);
  await mongoose.disconnect().catch(() => {});
  process.exitCode = 1;
});
