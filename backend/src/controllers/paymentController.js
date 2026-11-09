const AppError = require("../utils/AppError");
const createReference = require("../utils/createReference");
const serializePayment = require("../utils/serializePayment");
const serializeWalletTransaction = require("../utils/serializeWalletTransaction");
const userRepository = require("../repositories/userRepository");
const rideRepository = require("../repositories/rideRepository");
const paymentRepository = require("../repositories/paymentRepository");
const walletTransactionRepository = require("../repositories/walletTransactionRepository");

function idOf(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === "object") return String(value._id || value.id);
  return String(value);
}

function walletPayload(user) {
  return {
    balance: Number(user?.walletBalance) || 0,
    currency: "INR",
  };
}

function rideNotFound() {
  return new AppError("Ride not found.", { status: 404, code: "RIDE_NOT_FOUND" });
}

async function wallet(req, res) {
  const [account, transactions] = await Promise.all([
    userRepository.findById(req.user._id),
    walletTransactionRepository.listForUser(req.user._id, { limit: 30 }),
  ]);

  if (!account) {
    throw new AppError("Your account could not be found.", {
      status: 404,
      code: "ACCOUNT_NOT_FOUND",
    });
  }

  res.json({
    success: true,
    data: {
      wallet: walletPayload(account),
      transactions: transactions.map(serializeWalletTransaction),
    },
    error: null,
  });
}

async function topUp(req, res) {
  const amount = req.body.amount;
  const updated = await userRepository.addWalletBalance(req.user._id, amount);
  if (!updated) {
    throw new AppError("Your wallet could not be updated.", {
      status: 404,
      code: "ACCOUNT_NOT_FOUND",
    });
  }

  const transaction = await walletTransactionRepository.create({
    user: req.user._id,
    type: "topup",
    amount,
    balanceAfter: updated.walletBalance,
    description: "Wallet top-up",
    reference: createReference("TOP"),
  });

  res.status(201).json({
    success: true,
    data: {
      wallet: walletPayload(updated),
      transaction: serializeWalletTransaction(transaction),
    },
    error: null,
  });
}

async function ridePayment(req, res) {
  const ride = await rideRepository.findById(req.params.rideId);
  if (!ride) throw rideNotFound();
  if (![idOf(ride.rider), idOf(ride.driver)].includes(String(req.user._id))) {
    throw new AppError("You do not have access to this ride payment.", {
      status: 403,
      code: "RIDE_FORBIDDEN",
    });
  }

  const payment = await paymentRepository.findByRide(ride._id);
  res.json({
    success: true,
    data: {
      payment: serializePayment(payment),
      ride: {
        id: String(ride._id || ride.id),
        status: ride.status,
        amount: Number(ride.finalPrice ?? ride.offeredPrice ?? 0),
      },
    },
    error: null,
  });
}

async function payRide(req, res) {
  const ride = await rideRepository.findById(req.params.rideId);
  if (!ride) throw rideNotFound();
  if (idOf(ride.rider) !== String(req.user._id)) {
    throw new AppError("You do not have access to this ride payment.", {
      status: 403,
      code: "RIDE_FORBIDDEN",
    });
  }
  if (ride.status !== "completed") {
    throw new AppError("You can pay once the ride is complete.", {
      status: 409,
      code: "RIDE_NOT_COMPLETED",
    });
  }

  const existing = await paymentRepository.findByRide(ride._id);
  if (existing) {
    throw new AppError("This ride has already been paid.", {
      status: 409,
      code: "PAYMENT_ALREADY_COMPLETE",
    });
  }

  const method = req.body.method;
  const amount = Number(ride.finalPrice ?? ride.offeredPrice ?? 0);
  let walletAccount = null;
  let transaction = null;

  if (method === "wallet") {
    const balance = Number(req.user.walletBalance) || 0;
    if (balance < amount) {
      throw new AppError("Your wallet balance is too low for this fare.", {
        status: 402,
        code: "INSUFFICIENT_WALLET_BALANCE",
        details: [{ balance, amount, currency: "INR" }],
      });
    }

    walletAccount = await userRepository.deductWalletBalance(req.user._id, amount);
    if (!walletAccount) {
      throw new AppError("Your wallet balance is too low for this fare.", {
        status: 402,
        code: "INSUFFICIENT_WALLET_BALANCE",
        details: [{ balance, amount, currency: "INR" }],
      });
    }
  }

  let payment;
  try {
    payment = await paymentRepository.create({
      ride: ride._id,
      rider: idOf(ride.rider),
      driver: idOf(ride.driver),
      amount,
      method,
      status: "paid",
      reference: createReference("PAY"),
      paidAt: new Date(),
    });
  } catch (error) {
    if (walletAccount) {
      await userRepository.addWalletBalance(req.user._id, amount);
    }
    if (error?.code === 11000) {
      throw new AppError("This ride has already been paid.", {
        status: 409,
        code: "PAYMENT_ALREADY_COMPLETE",
      });
    }
    throw error;
  }

  if (method === "wallet") {
    transaction = await walletTransactionRepository.create({
      user: req.user._id,
      type: "ride_payment",
      amount,
      balanceAfter: walletAccount.walletBalance,
      ride: ride._id,
      description: "Ride fare",
      reference: payment.reference,
    });
  }

  res.status(201).json({
    success: true,
    data: {
      payment: serializePayment(payment),
      transaction: serializeWalletTransaction(transaction),
      wallet: walletAccount ? walletPayload(walletAccount) : null,
    },
    error: null,
  });
}

module.exports = { wallet, topUp, ridePayment, payRide };
