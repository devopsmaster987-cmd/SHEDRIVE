function idOf(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === "object") return String(value._id || value.id);
  return String(value);
}

function iso(value) {
  if (!value) return null;
  return value instanceof Date ? value.toISOString() : value;
}

function serializeWalletTransaction(transaction) {
  if (!transaction) return null;
  const raw = typeof transaction.toObject === "function" ? transaction.toObject() : transaction;

  return {
    id: String(raw._id || raw.id),
    type: raw.type,
    amount: raw.amount,
    balanceAfter: raw.balanceAfter,
    currency: raw.currency || "INR",
    rideId: idOf(raw.ride),
    description: raw.description || "",
    reference: raw.reference,
    createdAt: iso(raw.createdAt),
  };
}

module.exports = serializeWalletTransaction;
