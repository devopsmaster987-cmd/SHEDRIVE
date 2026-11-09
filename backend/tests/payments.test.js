const request = require("supertest");
const app = require("../src/app");
const userRepository = require("../src/repositories/userRepository");
const rideRepository = require("../src/repositories/rideRepository");
const paymentRepository = require("../src/repositories/paymentRepository");
const walletTransactionRepository = require("../src/repositories/walletTransactionRepository");
const { signAccessToken } = require("../src/services/tokenService");

jest.mock("../src/repositories/userRepository", () => ({
  findById: jest.fn(),
  addWalletBalance: jest.fn(),
  deductWalletBalance: jest.fn(),
}));

jest.mock("../src/repositories/rideRepository", () => ({
  findById: jest.fn(),
}));

jest.mock("../src/repositories/paymentRepository", () => ({
  create: jest.fn(),
  findByRide: jest.fn(),
}));

jest.mock("../src/repositories/walletTransactionRepository", () => ({
  create: jest.fn(),
  listForUser: jest.fn(),
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
    walletBalance: 500,
    isBanned: false,
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    ...overrides,
  };
}

function makeRide(overrides = {}) {
  return {
    _id: "ride-1",
    rider: { _id: "rider-1", name: "Aisha Khan" },
    driver: { _id: "driver-1", name: "Sana Iqbal" },
    offeredPrice: 240,
    finalPrice: 260,
    status: "completed",
    completedAt: new Date("2026-02-01T10:00:00.000Z"),
    ...overrides,
  };
}

function makePayment(overrides = {}) {
  return {
    _id: "payment-1",
    ride: "ride-1",
    rider: "rider-1",
    driver: "driver-1",
    amount: 260,
    currency: "INR",
    method: "wallet",
    status: "paid",
    reference: "PAY-TEST-1",
    paidAt: new Date("2026-02-01T10:05:00.000Z"),
    ...overrides,
  };
}

function makeTransaction(overrides = {}) {
  return {
    _id: "tx-1",
    user: "rider-1",
    type: "topup",
    amount: 250,
    balanceAfter: 750,
    currency: "INR",
    ride: null,
    description: "Wallet top-up",
    reference: "TOP-TEST-1",
    createdAt: new Date("2026-02-01T09:00:00.000Z"),
    ...overrides,
  };
}

function tokenFor(user) {
  return `Bearer ${signAccessToken(user)}`;
}

beforeEach(() => {
  jest.resetAllMocks();

  userRepository.findById.mockResolvedValue(makeUser());
  userRepository.addWalletBalance.mockResolvedValue(makeUser({ walletBalance: 750 }));
  userRepository.deductWalletBalance.mockResolvedValue(makeUser({ walletBalance: 240 }));
  rideRepository.findById.mockResolvedValue(makeRide());
  paymentRepository.findByRide.mockResolvedValue(null);
  paymentRepository.create.mockResolvedValue(makePayment());
  walletTransactionRepository.listForUser.mockResolvedValue([makeTransaction()]);
  walletTransactionRepository.create.mockResolvedValue(makeTransaction());
});

describe("wallet", () => {
  test("returns the rider balance and recent transactions", async () => {
    const res = await request(app)
      .get("/api/payments/wallet")
      .set("Authorization", tokenFor(makeUser()))
      .expect(200);

    expect(res.body.data.wallet).toEqual({ balance: 500, currency: "INR" });
    expect(res.body.data.transactions).toHaveLength(1);
    expect(res.body.data.transactions[0].type).toBe("topup");
  });

  test("tops up the wallet and records a ledger entry", async () => {
    const res = await request(app)
      .post("/api/payments/wallet/topup")
      .set("Authorization", tokenFor(makeUser()))
      .send({ amount: 250 })
      .expect(201);

    expect(res.body.data.wallet.balance).toBe(750);
    expect(res.body.data.transaction.amount).toBe(250);
    expect(userRepository.addWalletBalance).toHaveBeenCalledWith("rider-1", 250);
    expect(walletTransactionRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({
        user: "rider-1",
        type: "topup",
        amount: 250,
        balanceAfter: 750,
      })
    );
  });

  test("rejects a top-up below the minimum", async () => {
    const res = await request(app)
      .post("/api/payments/wallet/topup")
      .set("Authorization", tokenFor(makeUser()))
      .send({ amount: 50 })
      .expect(422);

    expect(res.body.error.code).toBe("VALIDATION_ERROR");
    expect(userRepository.addWalletBalance).not.toHaveBeenCalled();
  });

  test("keeps wallet routes for riders only", async () => {
    const driver = makeUser({ _id: "driver-1", role: "driver" });
    userRepository.findById.mockResolvedValue(driver);

    await request(app)
      .get("/api/payments/wallet")
      .set("Authorization", tokenFor(driver))
      .expect(403);
  });
});

describe("ride payments", () => {
  test("pays a completed ride from the wallet", async () => {
    const res = await request(app)
      .post("/api/payments/rides/ride-1")
      .set("Authorization", tokenFor(makeUser()))
      .send({ method: "wallet" })
      .expect(201);

    expect(res.body.data.payment.method).toBe("wallet");
    expect(res.body.data.payment.amount).toBe(260);
    expect(res.body.data.wallet.balance).toBe(240);
    expect(userRepository.deductWalletBalance).toHaveBeenCalledWith("rider-1", 260);
    expect(paymentRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({
        ride: "ride-1",
        rider: "rider-1",
        driver: "driver-1",
        amount: 260,
        method: "wallet",
        status: "paid",
      })
    );
    expect(walletTransactionRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "ride_payment",
        amount: 260,
        balanceAfter: 240,
      })
    );
  });

  test("marks a cash payment without touching the wallet", async () => {
    paymentRepository.create.mockResolvedValue(makePayment({ method: "cash" }));

    const res = await request(app)
      .post("/api/payments/rides/ride-1")
      .set("Authorization", tokenFor(makeUser()))
      .send({ method: "cash" })
      .expect(201);

    expect(res.body.data.payment.method).toBe("cash");
    expect(res.body.data.wallet).toBeNull();
    expect(userRepository.deductWalletBalance).not.toHaveBeenCalled();
    expect(walletTransactionRepository.create).not.toHaveBeenCalled();
  });

  test("blocks a wallet payment when the balance is too low", async () => {
    userRepository.findById.mockResolvedValue(makeUser({ walletBalance: 100 }));

    const res = await request(app)
      .post("/api/payments/rides/ride-1")
      .set("Authorization", tokenFor(makeUser({ walletBalance: 100 })))
      .send({ method: "wallet" })
      .expect(402);

    expect(res.body.error.code).toBe("INSUFFICIENT_WALLET_BALANCE");
    expect(userRepository.deductWalletBalance).not.toHaveBeenCalled();
    expect(paymentRepository.create).not.toHaveBeenCalled();
  });

  test("rejects payment before the ride is complete", async () => {
    rideRepository.findById.mockResolvedValue(makeRide({ status: "in_progress" }));

    const res = await request(app)
      .post("/api/payments/rides/ride-1")
      .set("Authorization", tokenFor(makeUser()))
      .send({ method: "cash" })
      .expect(409);

    expect(res.body.error.code).toBe("RIDE_NOT_COMPLETED");
  });

  test("rejects a second payment for the same ride", async () => {
    paymentRepository.findByRide.mockResolvedValue(makePayment());

    const res = await request(app)
      .post("/api/payments/rides/ride-1")
      .set("Authorization", tokenFor(makeUser()))
      .send({ method: "cash" })
      .expect(409);

    expect(res.body.error.code).toBe("PAYMENT_ALREADY_COMPLETE");
  });

  test("does not expose another rider's payment", async () => {
    const otherRider = makeUser({ _id: "rider-2" });
    userRepository.findById.mockResolvedValue(otherRider);

    const res = await request(app)
      .get("/api/payments/rides/ride-1")
      .set("Authorization", tokenFor(otherRider))
      .expect(403);

    expect(res.body.error.code).toBe("RIDE_FORBIDDEN");
  });
});
