function idOf(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === "object") return String(value._id || value.id);
  return String(value);
}

function iso(value) {
  if (!value) return null;
  return value instanceof Date ? value.toISOString() : value;
}

function serializeRating(rating) {
  if (!rating) return null;
  const raw = typeof rating.toObject === "function" ? rating.toObject() : rating;

  return {
    id: String(raw._id || raw.id),
    rideId: idOf(raw.ride),
    ratedBy: idOf(raw.ratedBy),
    ratedUser: idOf(raw.ratedUser),
    stars: raw.stars,
    comment: raw.comment || "",
    createdAt: iso(raw.createdAt),
  };
}

module.exports = serializeRating;
