const request = require("supertest");
const app = require("../src/app");
const userRepository = require("../src/repositories/userRepository");
const rideRepository = require("../src/repositories/rideRepository");
const ratingRepository = require("../src/repositories/ratingRepository");
const driverRepository = require("../src/repositories/driverRepository");
const { signAccessToken } = require("../src/services/tokenService");

jest.mock("../src/repositories/userRepository", () => ({
  findById: jest.fn(),
}));

jest.mock("../src/repositories/rideRepository", () => ({
  findById: jest.fn(),
}));

jest.mock("../src/repositories/ratingRepository", () => ({
  create: jest.fn(),
  findByRideAndRater: jest.fn(),
  averageForUser: jest.fn(),
}));

jest.mock("../src/repositories/driverRepository", () => ({
  updateByUser: jest.fn(),
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

function makeRide(overrides = {}) {
  return {
    _id: "ride-1",
    rider: { _id: "rider-1", name: "Aisha Khan" },
    driver: { _id: "driver-1", name: "Sana Iqbal" },
    status: "completed",
    completedAt: new Date("2026-02-01T10:00:00.000Z"),
    ...overrides,
  };
}

function makeRating(overrides = {}) {
  return {
    _id: "rating-1",
    ride: "ride-1",
    ratedBy: "rider-1",
    ratedUser: "driver-1",
    stars: 5,
    comment: "Felt safe and comfortable.",
    createdAt: new Date("2026-02-01T10:02:00.000Z"),
    ...overrides,
  };
}

function tokenFor(user) {
  return `Bearer ${signAccessToken(user)}`;
}

beforeEach(() => {
  jest.resetAllMocks();

  userRepository.findById.mockResolvedValue(makeUser());
  rideRepository.findById.mockResolvedValue(makeRide());
  ratingRepository.findByRideAndRater.mockResolvedValue(null);
  ratingRepository.create.mockResolvedValue(makeRating());
  ratingRepository.averageForUser.mockResolvedValue({ average: 4.5, count: 2 });
  driverRepository.updateByUser.mockResolvedValue({ ratingAvg: 4.5 });
});

describe("rating state", () => {
  test("shows the rider their driver counterpart and rating eligibility", async () => {
    const res = await request(app)
      .get("/api/ratings/rides/ride-1")
      .set("Authorization", tokenFor(makeUser()))
      .expect(200);

    expect(res.body.data.canRate).toBe(true);
    expect(res.body.data.counterpart).toEqual({
      id: "driver-1",
      name: "Sana Iqbal",
      role: "driver",
    });
    expect(res.body.data.rating).toBeNull();
  });

  test("hides the form after a rider has rated", async () => {
    ratingRepository.findByRideAndRater.mockResolvedValue(makeRating());

    const res = await request(app)
      .get("/api/ratings/rides/ride-1")
      .set("Authorization", tokenFor(makeUser()))
      .expect(200);

    expect(res.body.data.canRate).toBe(false);
    expect(res.body.data.rating.stars).toBe(5);
  });

  test("shows the driver their rider counterpart", async () => {
    userRepository.findById.mockResolvedValue(makeDriverUser());

    const res = await request(app)
      .get("/api/ratings/rides/ride-1")
      .set("Authorization", tokenFor(makeDriverUser()))
      .expect(200);

    expect(res.body.data.counterpart).toEqual({
      id: "rider-1",
      name: "Aisha Khan",
      role: "rider",
    });
  });
});

describe("submitting ratings", () => {
  test("lets a rider rate the driver and recomputes the driver average", async () => {
    const res = await request(app)
      .post("/api/ratings/rides/ride-1")
      .set("Authorization", tokenFor(makeUser()))
      .send({ stars: 5, comment: "Felt safe and comfortable." })
      .expect(201);

    expect(res.body.data.rating.stars).toBe(5);
    expect(res.body.data.driverRating).toEqual({ ratingAvg: 4.5, count: 2 });
    expect(ratingRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({
        ride: "ride-1",
        ratedBy: "rider-1",
        ratedUser: "driver-1",
        stars: 5,
      })
    );
    expect(driverRepository.updateByUser).toHaveBeenCalledWith("driver-1", {
      ratingAvg: 4.5,
    });
  });

  test("lets a driver rate the rider without changing driver stats", async () => {
    userRepository.findById.mockResolvedValue(makeDriverUser());
    ratingRepository.create.mockResolvedValue(
      makeRating({ ratedBy: "driver-1", ratedUser: "rider-1", stars: 4 })
    );

    const res = await request(app)
      .post("/api/ratings/rides/ride-1")
      .set("Authorization", tokenFor(makeDriverUser()))
      .send({ stars: 4, comment: "Ready at pickup." })
      .expect(201);

    expect(res.body.data.rating.stars).toBe(4);
    expect(res.body.data.driverRating).toBeNull();
    expect(driverRepository.updateByUser).not.toHaveBeenCalled();
  });

  test("rejects a duplicate rating", async () => {
    ratingRepository.findByRideAndRater.mockResolvedValue(makeRating());

    const res = await request(app)
      .post("/api/ratings/rides/ride-1")
      .set("Authorization", tokenFor(makeUser()))
      .send({ stars: 5 })
      .expect(409);

    expect(res.body.error.code).toBe("RATING_ALREADY_SUBMITTED");
    expect(ratingRepository.create).not.toHaveBeenCalled();
  });

  test("rejects rating an incomplete ride", async () => {
    rideRepository.findById.mockResolvedValue(makeRide({ status: "in_progress" }));

    const res = await request(app)
      .post("/api/ratings/rides/ride-1")
      .set("Authorization", tokenFor(makeUser()))
      .send({ stars: 5 })
      .expect(409);

    expect(res.body.error.code).toBe("RIDE_NOT_COMPLETED");
  });

  test("rejects ratings from users outside the ride", async () => {
    const otherRider = makeUser({ _id: "rider-2" });
    userRepository.findById.mockResolvedValue(otherRider);

    const res = await request(app)
      .post("/api/ratings/rides/ride-1")
      .set("Authorization", tokenFor(otherRider))
      .send({ stars: 5 })
      .expect(403);

    expect(res.body.error.code).toBe("RIDE_FORBIDDEN");
  });

  test("validates star values", async () => {
    const res = await request(app)
      .post("/api/ratings/rides/ride-1")
      .set("Authorization", tokenFor(makeUser()))
      .send({ stars: 6 })
      .expect(422);

    expect(res.body.error.code).toBe("VALIDATION_ERROR");
  });
});
