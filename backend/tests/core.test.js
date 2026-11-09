const request = require("supertest");
const app = require("../src/app");
const userRepository = require("../src/repositories/userRepository");
const driverRepository = require("../src/repositories/driverRepository");
const { signAccessToken } = require("../src/services/tokenService");

jest.mock("../src/repositories/userRepository", () => ({
  exists: jest.fn(),
  create: jest.fn(),
  findByEmail: jest.fn(),
  findById: jest.fn(),
  updateById: jest.fn(),
  deleteById: jest.fn(),
}));

jest.mock("../src/repositories/driverRepository", () => ({
  create: jest.fn(),
  deleteByUser: jest.fn(),
  findByUser: jest.fn(),
  updateByUser: jest.fn(),
  findNearby: jest.fn(),
  countOnline: jest.fn(),
  completedRides: jest.fn(),
}));

function makeUser(overrides = {}) {
  return {
    _id: "user-1",
    name: "Aisha Khan",
    email: "aisha@example.com",
    phone: "+919876543210",
    role: "rider",
    verificationStatus: "approved",
    phoneVerified: true,
    isBanned: false,
    emergencyContacts: [
      { name: "Maya Khan", phone: "+919876500000", relationship: "Sister" },
    ],
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    ...overrides,
  };
}

function makeDriver(overrides = {}) {
  return {
    _id: "driver-details-1",
    user: "user-1",
    vehicleType: "Car",
    plateNumber: "KA01AB1234",
    licenseDocStatus: "pending",
    ratingAvg: 4.9,
    isOnline: false,
    currentLocation: {
      type: "Point",
      coordinates: [77.5946, 12.9716],
    },
    ...overrides,
  };
}

function tokenFor(user) {
  return signAccessToken(user);
}

beforeEach(() => {
  jest.resetAllMocks();

  userRepository.findById.mockResolvedValue(makeUser());
  userRepository.updateById.mockImplementation(async (id, updates) => ({
    ...makeUser(),
    ...updates,
  }));
  driverRepository.findByUser.mockResolvedValue(makeDriver());
  driverRepository.updateByUser.mockImplementation(async (id, updates) => ({
    ...makeDriver(),
    ...updates,
  }));
  driverRepository.findNearby.mockResolvedValue([]);
  driverRepository.countOnline.mockResolvedValue(0);
  driverRepository.completedRides.mockResolvedValue([]);
});

describe("profile", () => {
  test("returns the signed-in user", async () => {
    const res = await request(app)
      .get("/api/users/me")
      .set("Authorization", `Bearer ${tokenFor(makeUser())}`)
      .expect(200);

    expect(res.body.data.user.email).toBe("aisha@example.com");
    expect(res.body.data.user.emergencyContacts).toHaveLength(1);
    expect(res.body.data.user.passwordHash).toBeUndefined();
  });

  test("updates the name and emergency contacts", async () => {
    const contacts = [
      { name: "Maya Khan", phone: "+919876500000", relationship: "Sister" },
      { name: "Noor Khan", phone: "+919876500001", relationship: "Friend" },
    ];

    const res = await request(app)
      .patch("/api/users/me")
      .set("Authorization", `Bearer ${tokenFor(makeUser())}`)
      .send({ name: "Aisha Noor", emergencyContacts: contacts })
      .expect(200);

    expect(res.body.data.user.name).toBe("Aisha Noor");
    expect(userRepository.updateById).toHaveBeenCalledWith(
      "user-1",
      expect.objectContaining({ name: "Aisha Noor", emergencyContacts: contacts })
    );
  });

  test("rejects an invalid emergency contact phone", async () => {
    const res = await request(app)
      .patch("/api/users/me")
      .set("Authorization", `Bearer ${tokenFor(makeUser())}`)
      .send({
        name: "Aisha Khan",
        emergencyContacts: [{ name: "Maya", phone: "abc", relationship: "" }],
      })
      .expect(422);

    expect(res.body.error.code).toBe("VALIDATION_ERROR");
    expect(userRepository.updateById).not.toHaveBeenCalled();
  });
});

describe("fare estimate", () => {
  const pickup = { lat: 12.9716, lng: 77.5946, label: "MG Road" };
  const drop = { lat: 12.9716, lng: 77.6546, label: "Indiranagar" };

  test("calculates distance and a suggested fare from coordinates", async () => {
    const res = await request(app)
      .post("/api/rides/estimate")
      .set("Authorization", `Bearer ${tokenFor(makeUser())}`)
      .send({ pickup, drop, vehicleType: "Car" })
      .expect(200);

    expect(res.body.data.estimate.distanceKm).toBeGreaterThan(5);
    expect(res.body.data.estimate.suggestedFare).toBeGreaterThan(50);
    expect(res.body.data.estimate.durationMinutes).toBeGreaterThan(3);
    expect(res.body.data.estimate.currency).toBe("PKR");
    expect(res.body.data.estimate.pickup.label).toBe("MG Road");
  });

  test("rejects a route with the same pickup and drop", async () => {
    const res = await request(app)
      .post("/api/rides/estimate")
      .set("Authorization", `Bearer ${tokenFor(makeUser())}`)
      .send({ pickup, drop: pickup, vehicleType: "Car" })
      .expect(422);

    expect(res.body.error.code).toBe("ROUTE_TOO_SHORT");
  });
});

describe("driver core", () => {
  test("lists nearby online drivers without account details", async () => {
    driverRepository.findNearby.mockResolvedValue([
      {
        _id: "driver-details-1",
        vehicleType: "Car",
        ratingAvg: 4.9,
        distanceMeters: 1240,
        currentLocation: { type: "Point", coordinates: [77.6, 12.98] },
      },
    ]);

    const res = await request(app)
      .get("/api/drivers/nearby?lat=12.9716&lng=77.5946&radiusKm=5")
      .set("Authorization", `Bearer ${tokenFor(makeUser())}`)
      .expect(200);

    expect(res.body.data.drivers).toEqual([
      {
        id: "driver-details-1",
        vehicleType: "Car",
        ratingAvg: 4.9,
        distanceKm: 1.2,
        currentLocation: { lng: 77.6, lat: 12.98 },
      },
    ]);
    expect(driverRepository.findNearby).toHaveBeenCalledWith({
      lat: 12.9716,
      lng: 77.5946,
      maxDistanceMeters: 5000,
    });
  });

  test("returns the driver dashboard and earnings summary", async () => {
    const driver = makeUser({
      _id: "driver-1",
      role: "driver",
      name: "Sana Driver",
      email: "driver@example.com",
    });
    userRepository.findById.mockResolvedValue(driver);
    driverRepository.completedRides.mockResolvedValue([
      { finalPrice: 210, completedAt: new Date() },
      { finalPrice: 150, completedAt: new Date("2020-01-01T00:00:00.000Z") },
    ]);
    driverRepository.countOnline.mockResolvedValue(4);

    const res = await request(app)
      .get("/api/drivers/me")
      .set("Authorization", `Bearer ${tokenFor(driver)}`)
      .expect(200);

    expect(res.body.data.driver.plateNumber).toBe("KA01AB1234");
    expect(res.body.data.driver.currentLocation).toEqual({ lng: 77.5946, lat: 12.9716 });
    expect(res.body.data.earnings.total).toBe(360);
    expect(res.body.data.earnings.today).toBe(210);
    expect(res.body.data.earnings.trips).toBe(2);
    expect(res.body.data.onlineDrivers).toBe(4);
  });

  test("toggles a verified driver online", async () => {
    const driver = makeUser({ _id: "driver-1", role: "driver" });
    userRepository.findById.mockResolvedValue(driver);
    driverRepository.countOnline.mockResolvedValue(3);

    const res = await request(app)
      .patch("/api/drivers/me/status")
      .set("Authorization", `Bearer ${tokenFor(driver)}`)
      .send({ isOnline: true })
      .expect(200);

    expect(res.body.data.driver.isOnline).toBe(true);
    expect(res.body.data.onlineDrivers).toBe(3);
    expect(driverRepository.updateByUser).toHaveBeenCalledWith("driver-1", {
      isOnline: true,
    });
  });

  test("blocks a driver whose verification is still under review", async () => {
    const driver = makeUser({
      _id: "driver-1",
      role: "driver",
      verificationStatus: "pending_review",
    });
    userRepository.findById.mockResolvedValue(driver);

    const res = await request(app)
      .patch("/api/drivers/me/status")
      .set("Authorization", `Bearer ${tokenFor(driver)}`)
      .send({ isOnline: true })
      .expect(403);

    expect(res.body.error.code).toBe("ACCOUNT_PENDING_REVIEW");
    expect(driverRepository.updateByUser).not.toHaveBeenCalled();
  });

  test("updates the driver location as GeoJSON", async () => {
    const driver = makeUser({ _id: "driver-1", role: "driver" });
    userRepository.findById.mockResolvedValue(driver);

    const res = await request(app)
      .patch("/api/drivers/me/location")
      .set("Authorization", `Bearer ${tokenFor(driver)}`)
      .send({ lat: 12.9352, lng: 77.6245 })
      .expect(200);

    expect(driverRepository.updateByUser).toHaveBeenCalledWith("driver-1", {
      currentLocation: { type: "Point", coordinates: [77.6245, 12.9352] },
    });
    expect(res.body.data.driver.currentLocation).toEqual({ lng: 77.6245, lat: 12.9352 });
  });

  test("prevents riders from opening the driver dashboard", async () => {
    const res = await request(app)
      .get("/api/drivers/me")
      .set("Authorization", `Bearer ${tokenFor(makeUser())}`)
      .expect(403);

    expect(res.body.error.code).toBe("FORBIDDEN");
  });
});
