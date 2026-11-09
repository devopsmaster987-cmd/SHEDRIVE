function serializeDriver(driver) {
  if (!driver) return null;

  const raw = typeof driver.toObject === "function" ? driver.toObject() : driver;
  const coordinates = raw.currentLocation?.coordinates;

  return {
    id: String(raw._id || raw.id),
    vehicleType: raw.vehicleType,
    plateNumber: raw.plateNumber,
    licenseDocStatus: raw.licenseDocStatus,
    licenseDocNote: raw.licenseDocNote || "",
    licenseDocReviewedAt: raw.licenseDocReviewedAt || null,
    ratingAvg: raw.ratingAvg,
    isOnline: Boolean(raw.isOnline),
    currentLocation:
      Array.isArray(coordinates) && coordinates.length === 2
        ? { lng: coordinates[0], lat: coordinates[1] }
        : null,
    createdAt: raw.createdAt instanceof Date ? raw.createdAt.toISOString() : raw.createdAt,
  };
}

module.exports = serializeDriver;
