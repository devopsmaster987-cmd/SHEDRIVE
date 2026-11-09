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

function serializeSosAlert(alert) {
  if (!alert) return null;
  const raw = typeof alert.toObject === "function" ? alert.toObject() : alert;
  const coordinates = raw.location?.coordinates || [];
  const ride = raw.ride;

  return {
    id: String(raw._id || raw.id),
    status: raw.status,
    message: raw.message || "",
    note: raw.note || "",
    contactsNotified: Number(raw.contactsNotified) || 0,
    location:
      Array.isArray(coordinates) && coordinates.length === 2
        ? { lng: coordinates[0], lat: coordinates[1] }
        : null,
    user:
      raw.user && typeof raw.user === "object"
        ? {
            id: String(raw.user._id || raw.user.id),
            name: raw.user.name || null,
            phone: raw.user.phone || null,
            role: raw.user.role || null,
          }
        : { id: idOf(raw.user), name: null, phone: null, role: null },
    ride: ride
      ? {
          id: idOf(ride),
          status: ride.status || null,
          pickupLabel: ride.pickupLabel || "",
          dropLabel: ride.dropLabel || "",
          rider: { id: idOf(ride.rider), name: nameOf(ride.rider) },
          driver: { id: idOf(ride.driver), name: nameOf(ride.driver) },
        }
      : null,
    handledBy: idOf(raw.handledBy),
    raisedAt: iso(raw.raisedAt || raw.createdAt),
    acknowledgedAt: iso(raw.acknowledgedAt),
    resolvedAt: iso(raw.resolvedAt),
    createdAt: iso(raw.createdAt),
  };
}

module.exports = serializeSosAlert;
