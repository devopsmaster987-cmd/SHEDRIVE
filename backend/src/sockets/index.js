const { Server } = require("socket.io");
const { createAdapter } = require("@socket.io/redis-adapter");
const { createClient } = require("redis");
const config = require("../config/env");
const userRepository = require("../repositories/userRepository");
const driverRepository = require("../repositories/driverRepository");
const rideRepository = require("../repositories/rideRepository");
const realtime = require("../services/realtime");
const { verifyAccessToken } = require("../services/tokenService");
const { activeSocketConnections } = require("../metrics");

let connectedSockets = 0;

function socketToken(socket) {
  const authToken = socket.handshake.auth?.token;
  if (authToken) return String(authToken);
  const header = socket.handshake.headers.authorization || "";
  return header.startsWith("Bearer ") ? header.slice(7).trim() : null;
}

function validCoordinates(payload) {
  return (
    Number.isFinite(Number(payload?.lat)) &&
    Number(payload.lat) >= -90 &&
    Number(payload.lat) <= 90 &&
    Number.isFinite(Number(payload.lng)) &&
    Number(payload.lng) >= -180 &&
    Number(payload.lng) <= 180
  );
}

function attachSockets(server) {
  const io = new Server(server, {
    cors: {
      origin: config.corsOrigins,
      credentials: true,
    },
  });

  realtime.setIo(io);

  io.use(async (socket, next) => {
    try {
      const token = socketToken(socket);
      if (!token) return next(new Error("AUTH_REQUIRED"));

      const payload = verifyAccessToken(token);
      const user = await userRepository.findById(payload.sub);
      if (!user || user.isBanned) return next(new Error("ACCOUNT_UNAVAILABLE"));

      socket.user = user;
      return next();
    } catch (error) {
      return next(new Error(error.name === "TokenExpiredError" ? "TOKEN_EXPIRED" : "INVALID_TOKEN"));
    }
  });

  io.on("connection", (socket) => {
    connectedSockets += 1;
    activeSocketConnections.set(connectedSockets);
    socket.join(`user:${String(socket.user._id)}`);
    if (socket.user.role === "admin") socket.join("admins");

    let lastLocationAt = 0;

    socket.on("ride:join", async (payload, ack) => {
      try {
        const rideId = String(payload?.rideId || "");
        const ride = await rideRepository.findRawById(rideId);
        if (!ride) return ack?.({ ok: false, code: "RIDE_NOT_FOUND" });

        const riderId = String(ride.rider?._id || ride.rider);
        const driverId = ride.driver ? String(ride.driver._id || ride.driver) : null;
        const userId = String(socket.user._id);
        if (userId !== riderId && userId !== driverId) {
          return ack?.({ ok: false, code: "FORBIDDEN" });
        }

        socket.join(`ride:${rideId}`);
        return ack?.({ ok: true });
      } catch {
        return ack?.({ ok: false, code: "RIDE_JOIN_FAILED" });
      }
    });

    socket.on("ride:leave", (payload) => {
      if (payload?.rideId) socket.leave(`ride:${String(payload.rideId)}`);
    });

    socket.on("driver:location", async (payload, ack) => {
      try {
        if (socket.user.role !== "driver") {
          return ack?.({ ok: false, code: "FORBIDDEN" });
        }
        if (!validCoordinates(payload)) {
          return ack?.({ ok: false, code: "INVALID_LOCATION" });
        }

        const rideId = String(payload?.rideId || "");
        const ride = await rideRepository.findRawById(rideId);
        if (!ride || String(ride.driver?._id || ride.driver) !== String(socket.user._id)) {
          return ack?.({ ok: false, code: "FORBIDDEN" });
        }

        const now = Date.now();
        if (now - lastLocationAt >= 1000) {
          lastLocationAt = now;
          await driverRepository.updateByUser(socket.user._id, {
            currentLocation: {
              type: "Point",
              coordinates: [Number(payload.lng), Number(payload.lat)],
            },
          });
        }

        const location = {
          rideId,
          lat: Number(payload.lat),
          lng: Number(payload.lng),
          at: new Date().toISOString(),
        };
        realtime.emitToRide(rideId, "ride:location", location);
        realtime.emitToUser(ride.rider?._id || ride.rider, "ride:location", location);
        return ack?.({ ok: true });
      } catch {
        return ack?.({ ok: false, code: "LOCATION_UPDATE_FAILED" });
      }
    });

    socket.on("disconnect", () => {
      connectedSockets = Math.max(0, connectedSockets - 1);
      activeSocketConnections.set(connectedSockets);
    });
  });

  return io;
}

// Kubernetes runs two API replicas. Redis pub/sub keeps Socket.IO rooms in sync
// across pods; local development and tests leave REDIS_URL unset and use the
// in-memory adapter. The returned function closes both Redis connections.
async function configureRealtimeAdapter(io) {
  if (!config.redisUrl) {
    return async () => {};
  }

  const pubClient = createClient({ url: config.redisUrl });
  const subClient = pubClient.duplicate();

  pubClient.on("error", (error) => {
    console.error("[socket] Redis publisher error:", error.message);
  });
  subClient.on("error", (error) => {
    console.error("[socket] Redis subscriber error:", error.message);
  });

  await Promise.all([pubClient.connect(), subClient.connect()]);
  io.adapter(createAdapter(pubClient, subClient));
  console.log("[socket] Redis adapter enabled for multi-replica realtime");

  return async () => {
    await Promise.allSettled([pubClient.quit(), subClient.quit()]);
  };
}

module.exports = { attachSockets, configureRealtimeAdapter };
