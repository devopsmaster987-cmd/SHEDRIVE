let io = null;

function setIo(server) {
  io = server;
}

function emitToUser(userId, event, payload) {
  if (!io || !userId) return;
  io.to(`user:${String(userId)}`).emit(event, payload);
}

function emitToRide(rideId, event, payload) {
  if (!io || !rideId) return;
  io.to(`ride:${String(rideId)}`).emit(event, payload);
}

function emitToAdmins(event, payload) {
  if (!io) return;
  io.to("admins").emit(event, payload);
}

function emitRideEvent(ride, event, payload) {
  if (!ride) return;

  const raw = typeof ride.toObject === "function" ? ride.toObject() : ride;
  const rideId = raw._id || raw.id;
  const riderId = raw.rider?._id || raw.rider;
  const driverId = raw.driver?._id || raw.driver;

  emitToRide(rideId, event, payload);
  emitToUser(riderId, event, payload);
  emitToUser(driverId, event, payload);
}

module.exports = { setIo, emitToUser, emitToRide, emitToAdmins, emitRideEvent };
