function serializeUser(user) {
  if (!user) return null;

  const raw = typeof user.toObject === "function" ? user.toObject() : user;

  return {
    id: String(raw._id || raw.id),
    name: raw.name,
    email: raw.email,
    phone: raw.phone,
    role: raw.role,
    verificationStatus: raw.verificationStatus,
    phoneVerified: Boolean(raw.phoneVerified),
    emergencyContacts: Array.isArray(raw.emergencyContacts)
      ? raw.emergencyContacts.map((contact) => ({
          name: contact.name,
          phone: contact.phone,
          relationship: contact.relationship || "",
        }))
      : [],
    walletBalance: Number(raw.walletBalance) || 0,
    isBanned: Boolean(raw.isBanned),
    moderationReason: raw.moderationReason || "",
    createdAt: raw.createdAt instanceof Date ? raw.createdAt.toISOString() : raw.createdAt,
  };
}

module.exports = serializeUser;
