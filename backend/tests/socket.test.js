const http = require("http");
const { io: createClient } = require("socket.io-client");
const app = require("../src/app");
const userRepository = require("../src/repositories/userRepository");
const driverRepository = require("../src/repositories/driverRepository");
const rideRepository = require("../src/repositories/rideRepository");
const realtime = require("../src/services/realtime");
const { attachSockets, configureRealtimeAdapter } = require("../src/sockets");
const { signAccessToken } = require("../src/services/tokenService");

jest.mock("../src/repositories/userRepository", () => ({
  findById: jest.fn(),
}));

jest.mock("../src/repositories/driverRepository", () => ({
  updateByUser: jest.fn(),
}));

jest.mock("../src/repositories/rideRepository", () => ({
  findRawById: jest.fn(),
}));

function makeUser(overrides = {}) {
  return {
    _id: "rider-1",
    name: "Aisha Khan",
    role: "rider",
    isBanned: false,
    ...overrides,
  };
}

function makeDriverUser() {
  return makeUser({
    _id: "driver-1",
    name: "Sana Iqbal",
    email: "driver@example.com",
    role: "driver",
  });
}

function tokenFor(user) {
  return signAccessToken(user);
}

function emitAck(socket, event, payload) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${event} ack timed out`)), 3000);
    socket.emit(event, payload, (response) => {
      clearTimeout(timer);
      resolve(response);
    });
  });
}

function once(socket, event) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${event} timed out`)), 3000);
    socket.once(event, (payload) => {
      clearTimeout(timer);
      resolve(payload);
    });
  });
}

let server;
let ioServer;
let baseUrl;
const clients = [];

beforeAll(async () => {
  server = http.createServer(app);
  ioServer = attachSockets(server);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

afterEach(() => {
  while (clients.length) clients.pop().close();
});

afterAll(async () => {
  await new Promise((resolve) => ioServer.close(resolve));
  await new Promise((resolve) => server.close(resolve));
});

beforeEach(() => {
  jest.clearAllMocks();
  userRepository.findById.mockImplementation(async (id) => {
    if (String(id) === "driver-1") return makeDriverUser();
    if (String(id) === "rider-1") return makeUser();
    return null;
  });
  rideRepository.findRawById.mockResolvedValue({
    _id: "ride-1",
    rider: "rider-1",
    driver: "driver-1",
  });
  driverRepository.updateByUser.mockResolvedValue({});
});

describe("Socket.IO adapter configuration", () => {
  test("uses the in-memory adapter and returns a no-op cleanup without REDIS_URL", async () => {
    const io = { adapter: jest.fn() };
    const closeAdapter = await configureRealtimeAdapter(io);

    expect(io.adapter).not.toHaveBeenCalled();
    await expect(closeAdapter()).resolves.toBeUndefined();
  });
});

describe("Socket.IO ride channel", () => {
  test("rejects an unauthenticated socket", async () => {
    const client = createClient(baseUrl, {
      auth: { token: "not-a-token" },
      transports: ["websocket"],
      reconnection: false,
    });
    clients.push(client);

    const error = await once(client, "connect_error");
    expect(error.message).toBe("INVALID_TOKEN");
    expect(client.connected).toBe(false);
  });

  test("lets a rider join the ride room and receive ride events", async () => {
    const client = createClient(baseUrl, {
      auth: { token: tokenFor(makeUser()) },
      transports: ["websocket"],
      reconnection: false,
    });
    clients.push(client);
    await once(client, "connect");

    const ack = await emitAck(client, "ride:join", { rideId: "ride-1" });
    expect(ack).toEqual({ ok: true });

    const received = once(client, "offer:new");
    realtime.emitToRide("ride-1", "offer:new", {
      offer: { id: "offer-1", offerPrice: 170 },
    });

    await expect(received).resolves.toEqual({
      offer: { id: "offer-1", offerPrice: 170 },
    });
  });

  test("blocks a user who is not part of the ride", async () => {
    userRepository.findById.mockResolvedValue(makeUser({ _id: "rider-2" }));
    const client = createClient(baseUrl, {
      auth: { token: tokenFor(makeUser({ _id: "rider-2" })) },
      transports: ["websocket"],
      reconnection: false,
    });
    clients.push(client);
    await once(client, "connect");

    const ack = await emitAck(client, "ride:join", { rideId: "ride-1" });
    expect(ack).toEqual({ ok: false, code: "FORBIDDEN" });
  });

  test("persists a driver location and broadcasts it to the rider", async () => {
    const riderClient = createClient(baseUrl, {
      auth: { token: tokenFor(makeUser()) },
      transports: ["websocket"],
      reconnection: false,
    });
    const driverClient = createClient(baseUrl, {
      auth: { token: tokenFor(makeDriverUser()) },
      transports: ["websocket"],
      reconnection: false,
    });
    clients.push(riderClient, driverClient);

    await Promise.all([once(riderClient, "connect"), once(driverClient, "connect")]);

    const locationEvent = once(riderClient, "ride:location");
    const ack = await emitAck(driverClient, "driver:location", {
      rideId: "ride-1",
      lat: 12.9716,
      lng: 77.5946,
    });

    expect(ack).toEqual({ ok: true });
    await expect(locationEvent).resolves.toEqual(
      expect.objectContaining({
        rideId: "ride-1",
        lat: 12.9716,
        lng: 77.5946,
      })
    );
    expect(driverRepository.updateByUser).toHaveBeenCalledWith(
      "driver-1",
      expect.objectContaining({
        currentLocation: { type: "Point", coordinates: [77.5946, 12.9716] },
      })
    );
  });
});
