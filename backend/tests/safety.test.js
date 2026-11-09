const request = require("supertest");
const app = require("../src/app");
const userRepository = require("../src/repositories/userRepository");
const rideRepository = require("../src/repositories/rideRepository");
const sosRepository = require("../src/repositories/sosRepository");
const notificationRepository = require("../src/repositories/notificationRepository");
const adminRepository = require("../src/repositories/adminRepository");
const reviewRepository = require("../src/repositories/reviewRepository");
const notificationService = require("../src/services/notificationService");
const realtime = require("../src/services/realtime");
const { signAccessToken } = require("../src/services/tokenService");

jest.mock("../src/repositories/userRepository", () => ({
  findById: jest.fn(),
  updateById: jest.fn(),
  findAdminIds: jest.fn(),
}));

jest.mock("../src/repositories/rideRepository", () => ({
  findById: jest.fn(),
}));

jest.mock("../src/repositories/sosRepository", () => ({
  create: jest.fn(),
  findById: jest.fn(),
  findOpenForUser: jest.fn(),
  list: jest.fn(),
  updateById: jest.fn(),
  countOpen: jest.fn(),
}));

jest.mock("../src/repositories/notificationRepository", () => ({
  create: jest.fn(),
  createMany: jest.fn(),
  listForUser: jest.fn(),
  countUnread: jest.fn(),
  markRead: jest.fn(),
  markAllRead: jest.fn(),
}));

jest.mock("../src/repositories/adminRepository", () => ({
  stats: jest.fn(),
  listUsers: jest.fn(),
  listDriverDocs: jest.fn(),
  findDriverDocById: jest.fn(),
  updateDriverDoc: jest.fn(),
  setDriverOffline: jest.fn(),
  recentRides: jest.fn(),
}));

jest.mock("../src/repositories/reviewRepository", () => ({
  findById: jest.fn(),
  update: jest.fn(),
  list: jest.fn(),
}));

jest.mock("../src/services/notificationService", () => ({
  dispatchSosAlert: jest.fn(),
}));

jest.mock("../src/services/realtime", () => ({
  emitToUser: jest.fn(),
  emitToRide: jest.fn(),
  emitToAdmins: jest.fn(),
  emitRideEvent: jest.fn(),
}));

const rider = {
  _id: "rider-1",
  name: "Aisha Khan",
  email: "rider@shedrive.test",
  phone: "+919876543210",
  role: "rider",
  verificationStatus: "approved",
  walletBalance: 1500,
  isBanned: false,
};

const driver = {
  _id: "driver-1",
  name: "Sana Iqbal",
  email: "driver@shedrive.test",
  phone: "+919876543211",
  role: "driver",
  verificationStatus: "approved",
  walletBalance: 0,
  isBanned: false,
};

const outsider = {
  _id: "rider-2",
  name: "Outside Rider",
  email: "outside@shedrive.test",
  phone: "+919876543299",
  role: "rider",
  verificationStatus: "approved",
  isBanned: false,
};

const admin = {
  _id: "admin-1",
  name: "Safety Admin",
  email: "admin@shedrive.test",
  phone: "+919876543219",
  role: "admin",
  verificationStatus: "approved",
  isBanned: false,
};

const ride = {
  _id: "ride-1",
  status: "accepted",
  rider: "rider-1",
  driver: "driver-1",
  pickupLabel: "MG Road",
  dropLabel: "Indiranagar",
  pickup: { type: "Point", coordinates: [77.5946, 12.9716] },
};

function tokenFor(user) {
  return signAccessToken(user);
}

function auth(user) {
  return { Authorization: `Bearer ${tokenFor(user)}` };
}

function makeAlert(overrides = {}) {
  return {
    _id: "sos-1",
    ride: {
      _id: ride._id,
      status: ride.status,
      pickupLabel: ride.pickupLabel,
      dropLabel: ride.dropLabel,
      rider: { _id: rider._id, name: rider.name },
      driver: { _id: driver._id, name: driver.name },
    },
    user: { _id: rider._id, name: rider.name, phone: rider.phone, role: rider.role },
    location: { type: "Point", coordinates: [77.5946, 12.9716] },
    status: "open",
    message: "Need help",
    note: "",
    contactsNotified: 0,
    raisedAt: new Date("2026-10-30T10:00:00.000Z"),
    createdAt: new Date("2026-10-30T10:00:00.000Z"),
    ...overrides,
  };
}

beforeEach(() => {
  jest.resetAllMocks();

  const users = {
    "rider-1": rider,
    "rider-2": outsider,
    "driver-1": driver,
    "admin-1": admin,
  };
  userRepository.findById.mockImplementation(async (id) => users[String(id)] || null);
  userRepository.updateById.mockImplementation(async (id, updates) => ({
    ...(users[String(id)] || rider),
    ...updates,
  }));
  userRepository.findAdminIds.mockResolvedValue(["admin-1"]);

  rideRepository.findById.mockResolvedValue(ride);
  sosRepository.findOpenForUser.mockResolvedValue(null);
  sosRepository.create.mockImplementation(async (data) => makeAlert(data));
  sosRepository.updateById.mockImplementation(async (_id, updates) => makeAlert(updates));
  sosRepository.findById.mockResolvedValue(makeAlert());
  sosRepository.list.mockResolvedValue({ items: [makeAlert()], total: 1 });
  sosRepository.countOpen.mockResolvedValue(1);

  notificationRepository.create.mockResolvedValue({});
  notificationRepository.createMany.mockResolvedValue([]);
  notificationRepository.listForUser.mockResolvedValue([]);
  notificationRepository.countUnread.mockResolvedValue(0);
  notificationRepository.markAllRead.mockResolvedValue({});

  notificationService.dispatchSosAlert.mockResolvedValue({
    contactsNotified: 2,
    channels: ["sms", "push"],
  });

  reviewRepository.list.mockResolvedValue({ items: [], total: 0 });
  adminRepository.setDriverOffline.mockResolvedValue({});
});

describe("SOS and notifications", () => {
  test("creates an SOS for a ride participant and alerts admins", async () => {
    const res = await request(app)
      .post("/api/sos/alerts")
      .set(auth(rider))
      .send({ rideId: ride._id, message: "Need help" })
      .expect(201);

    expect(res.body.data.alert.status).toBe("open");
    expect(res.body.data.alert.contactsNotified).toBe(2);
    expect(res.body.data.notifications.contactsNotified).toBe(2);
    expect(notificationService.dispatchSosAlert).toHaveBeenCalled();
    expect(notificationRepository.createMany).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({ user: rider._id, type: "sos" }),
        expect.objectContaining({ user: "admin-1", type: "sos" }),
      ])
    );
    expect(realtime.emitToAdmins).toHaveBeenCalledWith(
      "sos:triggered",
      expect.objectContaining({ alert: expect.objectContaining({ id: "sos-1" }) })
    );
  });

  test("blocks SOS for a user who is not on the ride", async () => {
    const res = await request(app)
      .post("/api/sos/alerts")
      .set(auth(outsider))
      .send({ rideId: ride._id })
      .expect(403);

    expect(res.body.error.code).toBe("RIDE_FORBIDDEN");
    expect(sosRepository.create).not.toHaveBeenCalled();
  });

  test("rejects a second active SOS", async () => {
    sosRepository.findOpenForUser.mockResolvedValue(makeAlert());

    const res = await request(app)
      .post("/api/sos/alerts")
      .set(auth(rider))
      .send({ rideId: ride._id })
      .expect(409);

    expect(res.body.error.code).toBe("SOS_ALREADY_OPEN");
    expect(sosRepository.create).not.toHaveBeenCalled();
  });

  test("returns the rider's current SOS", async () => {
    sosRepository.findOpenForUser.mockResolvedValue(makeAlert({ status: "acknowledged" }));

    const res = await request(app)
      .get("/api/sos/alerts/mine")
      .set(auth(rider))
      .expect(200);

    expect(res.body.data.alert.status).toBe("acknowledged");
    expect(res.body.data.alert.id).toBe("sos-1");
  });

  test("lists notifications and marks them all read", async () => {
    notificationRepository.listForUser.mockResolvedValue([
      {
        _id: "notification-1",
        type: "sos",
        title: "SOS shared",
        message: "The safety desk is with you.",
        readStatus: false,
        createdAt: new Date("2026-10-30T10:01:00.000Z"),
      },
    ]);
    notificationRepository.countUnread.mockResolvedValue(1);

    const list = await request(app)
      .get("/api/notifications")
      .set(auth(rider))
      .expect(200);

    expect(list.body.data.unread).toBe(1);
    expect(list.body.data.notifications[0]).toMatchObject({
      id: "notification-1",
      readStatus: false,
    });

    const readAll = await request(app)
      .post("/api/notifications/read-all")
      .set(auth(rider))
      .send({})
      .expect(200);

    expect(readAll.body.data.unread).toBe(0);
    expect(notificationRepository.markAllRead).toHaveBeenCalledWith(rider._id);
  });
});

describe("Admin safety and access actions", () => {
  test("suspends a driver and takes them offline", async () => {
    const res = await request(app)
      .patch("/api/admin/users/driver-1/access")
      .set(auth(admin))
      .send({ banned: true, reason: "Safety review" })
      .expect(200);

    expect(res.body.data.user.isBanned).toBe(true);
    expect(adminRepository.setDriverOffline).toHaveBeenCalledWith("driver-1");
    expect(notificationRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({ user: "driver-1", type: "account" })
    );
    expect(realtime.emitToUser).toHaveBeenCalledWith(
      "driver-1",
      "account:updated",
      expect.objectContaining({ isBanned: true })
    );
  });

  test("protects admin accounts from suspension", async () => {
    const res = await request(app)
      .patch("/api/admin/users/admin-1/access")
      .set(auth(admin))
      .send({ banned: true })
      .expect(409);

    expect(res.body.error.code).toBe("ADMIN_SELF_PROTECTED");
  });

  test("resolves an SOS and notifies the member", async () => {
    sosRepository.findById.mockResolvedValue(makeAlert());

    const res = await request(app)
      .patch("/api/admin/sos-alerts/sos-1")
      .set(auth(admin))
      .send({ status: "resolved", note: "Member reached safely." })
      .expect(200);

    expect(res.body.data.alert.status).toBe("resolved");
    expect(notificationRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({ user: rider._id, type: "sos" })
    );
    expect(realtime.emitToUser).toHaveBeenCalledWith(
      rider._id,
      "sos:updated",
      expect.objectContaining({ alert: expect.objectContaining({ status: "resolved" }) })
    );
    expect(realtime.emitToAdmins).toHaveBeenCalledWith("sos:updated", expect.any(Object));
  });

  test("reviews an identity queue item and sends an account notification", async () => {
    const pendingReview = {
      _id: "review-1",
      user: { _id: "rider-2", name: "New Rider" },
      status: "pending",
    };
    reviewRepository.findById.mockResolvedValue(pendingReview);
    reviewRepository.update.mockImplementation(async (record, updates) => ({
      ...record,
      ...updates,
      _id: "review-1",
    }));

    const res = await request(app)
      .patch("/api/admin/review-queue/review-1")
      .set(auth(admin))
      .send({ status: "approved", note: "Clear selfie." })
      .expect(200);

    expect(res.body.data.review.status).toBe("approved");
    expect(userRepository.updateById).toHaveBeenCalledWith("rider-2", {
      verificationStatus: "approved",
    });
    expect(notificationRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({ user: "rider-2", type: "account" })
    );
  });
});
