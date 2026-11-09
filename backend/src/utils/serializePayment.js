function idOf(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === "object") return String(value._id || value.id);
  return String(value);
}

function iso(value) {
  if (!value) return null;
  return value instanceof Date ? value.toISOString() : value;
}

function serializePayment(payment) {
  if (!payment) return null;
  const raw = typeof payment.toObject === "function" ? payment.toObject() : payment;

  return {
    id: String(raw._id || raw.id),
    rideId: idOf(raw.ride),
    amount: raw.amount,
    currency: raw.currency || "INR",
    method: raw.method,
    status: raw.status,
    reference: raw.reference,
    paidAt: iso(raw.paidAt),
    createdAt: iso(raw.createdAt),
  };
}

module.exports = serializePayment;
