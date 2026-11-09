const express = require("express");
const mongoose = require("mongoose");

const router = express.Router();

const DB_STATES = {
  0: "disconnected",
  1: "connected",
  2: "connecting",
  3: "disconnecting",
};

// Liveness/readiness endpoint used by Docker Compose, Kubernetes probes and CI.
router.get("/health", (_req, res) => {
  res.status(200).json({
    success: true,
    data: {
      status: "ok",
      service: "backend",
      uptimeSeconds: Math.round(process.uptime()),
      database: DB_STATES[mongoose.connection.readyState] || "unknown",
      timestamp: new Date().toISOString(),
    },
  });
});

// Readiness is stricter than liveness: Kubernetes must not send traffic until
// MongoDB is connected. Liveness keeps using /health so a DB outage does not
// trigger a pointless restart loop.
router.get("/health/ready", (_req, res) => {
  const database = DB_STATES[mongoose.connection.readyState] || "unknown";
  if (mongoose.connection.readyState !== 1) {
    return res.status(503).json({
      success: false,
      data: { status: "not_ready", service: "backend", database },
      error: {
        code: "NOT_READY",
        message: "MongoDB is not connected.",
        details: null,
      },
    });
  }

  return res.status(200).json({
    success: true,
    data: {
      status: "ready",
      service: "backend",
      database,
      timestamp: new Date().toISOString(),
    },
  });
});

module.exports = router;
