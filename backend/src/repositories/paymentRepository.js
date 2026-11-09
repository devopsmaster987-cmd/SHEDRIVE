const Payment = require("../models/Payment");

async function create(data) {
  return Payment.create(data);
}

async function findByRide(rideId) {
  return Payment.findOne({ ride: rideId });
}

module.exports = { create, findByRide };
