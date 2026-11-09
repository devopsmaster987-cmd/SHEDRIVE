function idOf(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === "object") return String(value._id || value.id);
  return String(value);
}

function iso(value) {
  if (!value) return null;
  return value instanceof Date ? value.toISOString() : value;
}

function serializeNotification(notification) {
  if (!notification) return null;
  const raw =
    typeof notification.toObject === "function" ? notification.toObject() : notification;

  return {
    id: String(raw._id || raw.id),
    type: raw.type,
    title: raw.title,
    message: raw.message,
    readStatus: Boolean(raw.readStatus),
    rideId: idOf(raw.ride),
    sosAlertId: idOf(raw.sosAlert),
    readAt: iso(raw.readAt),
    createdAt: iso(raw.createdAt),
  };
}

module.exports = serializeNotification;
