function maskPhone(phone) {
  const value = String(phone || "");
  if (value.length <= 4) return value;
  return `${value.slice(0, 2)}••••${value.slice(-2)}`;
}

// Demo-only dispatch. A production build would replace this with an SMS/voice
// provider adapter; nothing is sent outside this process.
async function dispatchSosAlert(alert, user) {
  const contacts = Array.isArray(user?.emergencyContacts) ? user.emergencyContacts : [];
  const deliveries = contacts.map((contact) => {
    if (!/production/i.test(process.env.NODE_ENV || "")) {
      console.info(
        `[notifications:mock] SOS ${alert?._id || alert?.id || "new"} -> ${contact.name || "contact"} (${maskPhone(contact.phone)})`
      );
    }
    return {
      name: contact.name || "Emergency contact",
      relationship: contact.relationship || "",
      channel: "mock-sms",
      delivered: true,
    };
  });

  return {
    contactsNotified: deliveries.length,
    channels: ["mock-sms"],
    deliveries,
  };
}

module.exports = { dispatchSosAlert };
