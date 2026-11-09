const request = require("supertest");
const app = require("../src/app");
const userRepository = require("../src/repositories/userRepository");
const driverRepository = require("../src/repositories/driverRepository");
const rideRepository = require("../src/repositories/rideRepository");
const offerRepository = require("../src/repositories/offerRepository");
const realtime = require("../src/services/realtime");
const { signAccessToken } = require("../src/services/tokenService");

jest.mock("../src/repositories/userRepository", () => ({
  findById: jest.fn(),
}));

jest.mock("../src/repositories/driverRepository", () => ({
  findByUser: jest.fn(),
  findNearby: jest.fn(),
  updateByUser: jest.fn(),
}));

jest.mock("../src/repositories/rideRepository", () => ({
  create: jest.fn(),
  findById: jest.fn(),
  findRawById: jest.fn(),
  findActiveForRider: jest.fn(),
  findActiveForDriver: jest.fn(),
  findActiveForUser: jest.fn(),
  updateById: jest.fn(),
  assignDriver: jest.fn(),
  listForUser: jest.fn(),
  findNearbySearching: jest.fn(),
}));

jest.mock("../src/repositories/offerRepository", () => ({
  upsertPending: jest.fn(),
  findById: jest.fn(),
  findPendingForRide: jest.fn(),
  findPendingForDriver: jest.fn(),
  expireStale: jest.fn(),
  markAccepted: jest.fn(),
  rejectOthers: jest.fn(),
  rejectForRide: jest.fn(),
}));

jest.mock("../src/services/realtime", () => ({
  setIo: jest.fn(),
  emitToUser: jest.fn(),
  emitToRide: jest.fn(),
  emitRideEvent: jest.fn(),
}));

function makeUser(overrides = {}) {
  return {
    _id: "rider-1",
    name: "Aisha Khan",
    email: "rider@example.com",
    phone: "+919876543210",
    role: "rider",
    verificationStatus: "approved",
    phoneVerified: true,
    isBanned: false,
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    ...overrides,
  };
}

function makeDriverUser(overrides = {}) {
  return makeUser({
    _id: "driver-1",
    name: "Sana Iqbal",
    email: "driver@example.com",
    phone: "+919876543211",
    role: "driver",
    ...overrides,
  });
}

function makeDriverDetails(overrides = {}) {
  return {
    _id: "details-1",
    user: "driver-1",
    vehicleType: "Car",
    plateNumber: "KA01AB1234",
    licenceDocStatus: "approved",
    licenseDocStatus: "approved",
    ratingAvg: 4.92,
    isOnline: true,
    activeRide: null,
    currentLocation: { type: "Point", coordinates: [77.5946, 12.9716] },
    ...overrides,
  };
}

function makeRide(overrides = {}) {
  return {
    _id: "ride-1",
    rider: { _id: "rider-1", name: "Aisha Khan" },
    driver: null,
    pickup: { type: "Point", coordinates: [77.5946, 12.9716] },
    drop: { type: "Point", coordinates: [77.6546, 12.9716] },
    pickupLabel: "MG Road",
    dropLabel: "Indiranagar",
    vehicleType: "Car",
    distanceKm: 8.2,
    durationMinutes: 22,
    offeredPrice: 160,
    finalPrice: null,
    acceptedOffer: null,
    status: "searching",
    createdAt: new Date("2026-02-01T10:00:00.000Z"),
    ...overrides,
  };
}

function makeOffer(overrides = {}) {
  return {
    _id: "offer-1",
    ride: "ride-1",
    driver: "driver-1",
    driverName: "Sana Iqbal",
    vehicleType: "Car",
    plateNumber: "KA01AB1234",
    ratingAvg: 4.92,
    offerPrice: 170,
    note: "I can be there in 4 minutes.",
    status: "pending",
    expiresAt: new Date(Date.now() + 30000),
    createdAt: new Date("2026-02-01T10:00:10.000Z"),
    ...overrides,
  };
}

function tokenFor(user) {
  return `Bearer ${signAccessToken(user)}`;
}

function createBody(overrides = {}) {
  return {
    pickup: { lat: 12.9716, lng: 77.5946, label: "MG Road" },
    drop: { lat: 12.9716, lng: 77.6546, label: "Indiranagar" },
    vehicleType: "Car",
    offeredPrice: 160,
    ...overrides,
  };
}

beforeEach(() => {
  jest.resetAllMocks();

  userRepository.findById.mockResolvedValue(makeUser());
  driverRepository.findByUser.mockResolvedValue(makeDriverDetails());
  driverRepository.findNearby.mockResolvedValue([{ user: "driver-1" }]);
  driverRepository.updateByUser.mockResolvedValue(makeDriverDetails());
  rideRepository.findActiveForRider.mockResolvedValue(null);
  rideRepository.findActiveForDriver.mockResolvedValue(null);
  rideRepository.findNearbySearching.mockResolvedValue([]);
  rideRepository.listForUser.mockResolvedValue([]);
  offerRepository.findPendingForRide.mockResolvedValue([]);
  offerRepository.expireStale.mockResolvedValue({ modifiedCount: 0 });
  offerRepository.markAccepted.mockResolvedValue(makeOffer({ status: "accepted" }));
  offerRepository.rejectOthers.mockResolvedValue({ modifiedCount: 0 });
  offerRepository.rejectForRide.mockResolvedValue({ modifiedCount: 0 });
});

describe("ride requests", () => {
  test("creates a ride and notifies nearby matching drivers", async () => {
    rideRepository.create.mockResolvedValue(makeRide());
    rideRepository.findById.mockResolvedValue(makeRide());

    const res = await request(app)
      .post("/api/rides")
      .set("Authorization", tokenFor(makeUser()))
      .send(createBody())
      .expect(201);

    expect(res.body.data.ride.status).toBe("searching");
    expect(res.body.data.ride.offeredPrice).toBe(160);
    expect(res.body.data.driversNotified).toBe(1);
    expect(rideRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({
        rider: "rider-1",
        pickup: { type: "Point", coordinates: [77.5946, 12.9716] },
        drop: { type: "Point", coordinates: [77.6546, 12.9716] },
        status: "searching",
      })
    );
    expect(realtime.emitToUser).toHaveBeenCalledWith(
      "driver-1",
      "ride:request",
      expect.objectContaining({ ride: expect.objectContaining({ id: "ride-1" }) })
    );
  });

  test("blocks a second active ride for the same rider", async () => {
    rideRepository.findActiveForRider.mockResolvedValue(makeRide());

    const res = await request(app)
      .post("/api/rides")
      .set("Authorization", tokenFor(makeUser()))
      .send(createBody())
      .expect(409);

    expect(res.body.error.code).toBe("RIDE_ALREADY_ACTIVE");
    expect(rideRepository.create).not.toHaveBeenCalled();
  });

  test("returns the rider's active ride with pending offers", async () => {
    rideRepository.findActiveForRider.mockResolvedValue(makeRide());
    offerRepository.findPendingForRide.mockResolvedValue([makeOffer()]);

    const res = await request(app)
      .get("/api/rides/active")
      .set("Authorization", tokenFor(makeUser()))
      .expect(200);

    expect(res.body.data.ride.id).toBe("ride-1");
    expect(res.body.data.ride.offers).toHaveLength(1);
    expect(res.body.data.ride.offers[0].driver.name).toBe("Sana Iqbal");
  });

  test("rejects an offer below the minimum price", async () => {
    const res = await request(app)
      .post("/api/rides")
      .set("Authorization", tokenFor(makeUser()))
      .send(createBody({ offeredPrice: 10 }))
      .expect(422);

    expect(res.body.error.code).toBe("VALIDATION_ERROR");
  });
});

describe("driver offers", () => {
  test("lists nearby searching rides for an online driver", async () => {
    userRepository.findById.mockResolvedValue(makeDriverUser());
    rideRepository.findNearbySearching.mockResolvedValue([
      { ...makeRide(), riderName: "Aisha Khan" },
    ]);

    const res = await request(app)
      .get("/api/rides/opportunities")
      .set("Authorization", tokenFor(makeDriverUser()))
      .expect(200);

    expect(res.body.data.rides).toHaveLength(1);
    expect(res.body.data.rides[0].rider.name).toBe("Aisha Khan");
    expect(rideRepository.findNearbySearching).toHaveBeenCalledWith(
      expect.objectContaining({ vehicleType: "Car", maxDistanceMeters: 5000 })
    );
  });

  test("creates an accept-or-counter offer and emits it to the rider", async () => {
    userRepository.findById.mockResolvedValue(makeDriverUser());
    rideRepository.findById.mockResolvedValue(makeRide());
    offerRepository.upsertPending.mockResolvedValue(makeOffer());

    const res = await request(app)
      .post("/api/rides/ride-1/offers")
      .set("Authorization", tokenFor(makeDriverUser()))
      .send({ offerPrice: 170, note: "I can be there in 4 minutes." })
      .expect(201);

    expect(res.body.data.offer.offerPrice).toBe(170);
    expect(offerRepository.upsertPending).toHaveBeenCalledWith(
      expect.objectContaining({
        ride: "ride-1",
        driver: "driver-1",
        driverName: "Sana Iqbal",
        offerPrice: 170,
      })
    );
    expect(realtime.emitToUser).toHaveBeenCalledWith(
      "rider-1",
      "offer:new",
      expect.objectContaining({ offer: expect.objectContaining({ id: "offer-1" }) })
    );
  });

  test("rejects a driver offering on the wrong vehicle type", async () => {
    userRepository.findById.mockResolvedValue(makeDriverUser());
    rideRepository.findById.mockResolvedValue(makeRide({ vehicleType: "Bike" }));

    const res = await request(app)
      .post("/api/rides/ride-1/offers")
      .set("Authorization", tokenFor(makeDriverUser()))
      .send({ offerPrice: 170 })
      .expect(422);

    expect(res.body.error.code).toBe("VEHICLE_MISMATCH");
    expect(offerRepository.upsertPending).not.toHaveBeenCalled();
  });

  test("requires the driver to be online", async () => {
    userRepository.findById.mockResolvedValue(makeDriverUser());
    driverRepository.findByUser.mockResolvedValue(makeDriverDetails({ isOnline: false }));

    const res = await request(app)
      .post("/api/rides/ride-1/offers")
      .set("Authorization", tokenFor(makeDriverUser()))
      .send({ offerPrice: 170 })
      .expect(409);

    expect(res.body.error.code).toBe("DRIVER_OFFLINE");
  });
});

describe("offer acceptance", () => {
  test("accepts one offer, assigns the driver and rejects the rest", async () => {
    const assigned = makeRide({
      driver: { _id: "driver-1", name: "Sana Iqbal" },
      finalPrice: 170,
      status: "accepted",
      acceptedAt: new Date(),
    });
    rideRepository.findById.mockResolvedValue(makeRide());
    offerRepository.findById.mockResolvedValue(makeOffer());
    rideRepository.assignDriver.mockResolvedValue(assigned);

    const res = await request(app)
      .post("/api/rides/ride-1/offers/offer-1/accept")
      .set("Authorization", tokenFor(makeUser()))
      .expect(200);

    expect(res.body.data.ride.status).toBe("accepted");
    expect(res.body.data.ride.finalPrice).toBe(170);
    expect(res.body.data.ride.driver.name).toBe("Sana Iqbal");
    expect(offerRepository.markAccepted).toHaveBeenCalledWith("offer-1", expect.any(Date));
    expect(offerRepository.rejectOthers).toHaveBeenCalledWith(
      "ride-1",
      "offer-1",
      expect.any(Date)
    );
    expect(driverRepository.updateByUser).toHaveBeenCalledWith("driver-1", {
      activeRide: "ride-1",
    });
    expect(realtime.emitRideEvent).toHaveBeenCalledWith(
      assigned,
      "offer:accepted",
      expect.objectContaining({ ride: expect.objectContaining({ status: "accepted" }) })
    );
  });

  test("rejects an expired offer", async () => {
    rideRepository.findById.mockResolvedValue(makeRide());
    offerRepository.findById.mockResolvedValue(
      makeOffer({ expiresAt: new Date(Date.now() - 1000) })
    );

    const res = await request(app)
      .post("/api/rides/ride-1/offers/offer-1/accept")
      .set("Authorization", tokenFor(makeUser()))
      .expect(409);

    expect(res.body.error.code).toBe("OFFER_UNAVAILABLE");
    expect(rideRepository.assignDriver).not.toHaveBeenCalled();
  });
});

describe("ride state changes", () => {
  test("moves an accepted ride to arriving", async () => {
    userRepository.findById.mockResolvedValue(makeDriverUser());
    rideRepository.findById.mockResolvedValue(
      makeRide({ driver: { _id: "driver-1", name: "Sana Iqbal" }, status: "accepted" })
    );
    rideRepository.updateById.mockResolvedValue(
      makeRide({
        driver: { _id: "driver-1", name: "Sana Iqbal" },
        status: "arriving",
        arrivedAt: new Date(),
      })
    );

    const res = await request(app)
      .patch("/api/rides/ride-1/status")
      .set("Authorization", tokenFor(makeDriverUser()))
      .send({ status: "arriving" })
      .expect(200);

    expect(res.body.data.ride.status).toBe("arriving");
    expect(rideRepository.updateById).toHaveBeenCalledWith(
      "ride-1",
      expect.objectContaining({ status: "arriving", arrivedAt: expect.any(Date) }),
      { filter: { driver: "driver-1", status: "accepted" } }
    );
  });

  test("completes an in-progress ride and releases the driver", async () => {
    userRepository.findById.mockResolvedValue(makeDriverUser());
    rideRepository.findById.mockResolvedValue(
      makeRide({
        driver: { _id: "driver-1", name: "Sana Iqbal" },
        status: "in_progress",
        finalPrice: 170,
      })
    );
    rideRepository.updateById.mockResolvedValue(
      makeRide({
        driver: { _id: "driver-1", name: "Sana Iqbal" },
        status: "completed",
        finalPrice: 170,
        completedAt: new Date(),
      })
    );

    const res = await request(app)
      .patch("/api/rides/ride-1/status")
      .set("Authorization", tokenFor(makeDriverUser()))
      .send({ status: "completed" })
      .expect(200);

    expect(res.body.data.ride.status).toBe("completed");
    expect(res.body.data.ride.finalPrice).toBe(170);
    expect(driverRepository.updateByUser).toHaveBeenCalledWith("driver-1", {
      activeRide: null,
    });
  });

  test("rejects an invalid status jump", async () => {
    userRepository.findById.mockResolvedValue(makeDriverUser());
    rideRepository.findById.mockResolvedValue(
      makeRide({ driver: { _id: "driver-1", name: "Sana Iqbal" }, status: "accepted" })
    );

    const res = await request(app)
      .patch("/api/rides/ride-1/status")
      .set("Authorization", tokenFor(makeDriverUser()))
      .send({ status: "completed" })
      .expect(409);

    expect(res.body.error.code).toBe("INVALID_RIDE_TRANSITION");
  });

  test("lets a driver cancel and releases the active ride", async () => {
    userRepository.findById.mockResolvedValue(makeDriverUser());
    const accepted = makeRide({
      driver: { _id: "driver-1", name: "Sana Iqbal" },
      status: "accepted",
    });
    rideRepository.findById.mockResolvedValue(accepted);
    rideRepository.updateById.mockResolvedValue(
      makeRide({
        driver: { _id: "driver-1", name: "Sana Iqbal" },
        status: "cancelled",
        cancelledBy: "driver",
      })
    );

    const res = await request(app)
      .post("/api/rides/ride-1/cancel")
      .set("Authorization", tokenFor(makeDriverUser()))
      .send({ reason: "Vehicle issue" })
      .expect(200);

    expect(res.body.data.ride.status).toBe("cancelled");
    expect(offerRepository.rejectForRide).toHaveBeenCalledWith("ride-1");
    expect(driverRepository.updateByUser).toHaveBeenCalledWith("driver-1", {
      activeRide: null,
    });
    expect(realtime.emitRideEvent).toHaveBeenCalledWith(
      expect.objectContaining({ status: "cancelled" }),
      "ride:status",
      expect.any(Object)
    );
  });

  test("prevents a different rider from reading the ride", async () => {
    const otherRider = makeUser({ _id: "rider-2" });
    userRepository.findById.mockResolvedValue(otherRider);
    rideRepository.findById.mockResolvedValue(makeRide());

    const res = await request(app)
      .get("/api/rides/ride-1")
      .set("Authorization", tokenFor(otherRider))
      .expect(403);

    expect(res.body.error.code).toBe("RIDE_FORBIDDEN");
  });
});
