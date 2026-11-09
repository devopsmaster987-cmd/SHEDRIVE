const express = require("express");
const helmet = require("helmet");
const cors = require("cors");

const config = require("./config/env");
const { metricsMiddleware, metricsHandler } = require("./metrics");
const healthRoutes = require("./routes/health");
const authRoutes = require("./routes/auth");
const userRoutes = require("./routes/users");
const driverRoutes = require("./routes/drivers");
const rideRoutes = require("./routes/rides");
const paymentRoutes = require("./routes/payments");
const ratingRoutes = require("./routes/ratings");
const sosRoutes = require("./routes/sos");
const notificationRoutes = require("./routes/notifications");
const adminRoutes = require("./routes/admin");
const { notFound, errorHandler } = require("./middleware/errorHandler");

const app = express();

// Behind nginx / an AWS load balancer, trust the proxy for correct client IPs.
app.set("trust proxy", 1);

app.use(helmet());

// CORS is limited to the origins listed in CORS_ORIGINS.
app.use(
  cors({
    origin(origin, callback) {
      // Requests without an Origin header (curl, health probes, server-to-server) pass.
      if (!origin || config.corsOrigins.includes(origin)) {
        return callback(null, true);
      }
      return callback(null, false);
    },
    credentials: true,
  })
);

app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: true, limit: "1mb" }));

// Prometheus request metrics for every route.
app.use(metricsMiddleware);

app.use(healthRoutes);
app.get("/metrics", metricsHandler);

app.get("/api", (_req, res) => {
  res.json({
    success: true,
    data: { name: "SheDrive API", version: "1.0.0", status: "phase-10-hardening" },
  });
});

app.use("/api/auth", authRoutes);
app.use("/api/users", userRoutes);
app.use("/api/drivers", driverRoutes);
app.use("/api/rides", rideRoutes);
app.use("/api/payments", paymentRoutes);
app.use("/api/ratings", ratingRoutes);
app.use("/api/sos", sosRoutes);
app.use("/api/notifications", notificationRoutes);
app.use("/api/admin", adminRoutes);

app.use(notFound);
app.use(errorHandler);

module.exports = app;
