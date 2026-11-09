function iso(value) {
  if (!value) return null;
  return value instanceof Date ? value.toISOString() : value;
}

function serializeOffer(offer) {
  if (!offer) return null;

  const raw = typeof offer.toObject === "function" ? offer.toObject() : offer;
  const driverId =
    raw.driver && typeof raw.driver === "object"
      ? String(raw.driver._id || raw.driver.id)
      : String(raw.driver);

  return {
    id: String(raw._id || raw.id),
    rideId: String(raw.ride?._id || raw.ride),
    driver: {
      id: driverId,
      name: raw.driverName || raw.driver?.name || "SheDrive driver",
      vehicleType: raw.vehicleType,
      plateNumber: raw.plateNumber,
      ratingAvg: raw.ratingAvg,
    },
    offerPrice: raw.offerPrice,
    note: raw.note || "",
    status: raw.status,
    expiresAt: iso(raw.expiresAt),
    respondedAt: iso(raw.respondedAt),
    createdAt: iso(raw.createdAt),
  };
}

module.exports = serializeOffer;
