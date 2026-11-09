function idOf(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === "object") return String(value._id || value.id);
  return String(value);
}

function nameOf(value) {
  return value && typeof value === "object" ? value.name || null : null;
}

function iso(value) {
  if (!value) return null;
  return value instanceof Date ? value.toISOString() : value;
}

function pointOf(raw, prefix) {
  const coordinates = raw[prefix]?.coordinates;
  if (!Array.isArray(coordinates) || coordinates.length !== 2) return null;

  return {
    lng: coordinates[0],
    lat: coordinates[1],
    label: raw[`${prefix}Label`] || "",
  };
}

function serializeRide(ride, { viewerId = null, driverDetails = null, offers = null } = {}) {
  if (!ride) return null;

  const raw = typeof ride.toObject === "function" ? ride.toObject() : ride;
  const details =
    driverDetails && typeof driverDetails.toObject === "function"
      ? driverDetails.toObject()
      : driverDetails;
  const riderId = idOf(raw.rider);
  const driverId = idOf(raw.driver);
  const participant = viewerId && [riderId, driverId].includes(String(viewerId));
  const cancellable = ["searching", "accepted", "arriving"].includes(raw.status);

  return {
    id: String(raw._id || raw.id),
    status: raw.status,
    rider: {
      id: riderId,
      name: nameOf(raw.rider) || raw.riderName || null,
    },
    driver: raw.driver
      ? {
          id: driverId,
          name: nameOf(raw.driver),
          vehicleType: details?.vehicleType || null,
          plateNumber: details?.plateNumber || null,
          ratingAvg: details?.ratingAvg ?? null,
          currentLocation: details?.currentLocation?.coordinates?.length === 2
            ? {
                lng: details.currentLocation.coordinates[0],
                lat: details.currentLocation.coordinates[1],
              }
            : null,
        }
      : null,
    pickup: pointOf(raw, "pickup"),
    drop: pointOf(raw, "drop"),
    vehicleType: raw.vehicleType,
    distanceKm: raw.distanceKm,
    durationMinutes: raw.durationMinutes,
    offeredPrice: raw.offeredPrice,
    finalPrice: raw.finalPrice,
    acceptedOffer: idOf(raw.acceptedOffer),
    canCancel: Boolean(participant && cancellable),
    createdAt: iso(raw.createdAt),
    acceptedAt: iso(raw.acceptedAt),
    arrivedAt: iso(raw.arrivedAt),
    startedAt: iso(raw.startedAt),
    completedAt: iso(raw.completedAt),
    cancelledAt: iso(raw.cancelledAt),
    cancelledBy: raw.cancelledBy || null,
    cancellationReason: raw.cancellationReason || "",
    ...(offers ? { offers } : {}),
  };
}

module.exports = serializeRide;
