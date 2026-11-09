// Prometheus metrics shared by the API and (later) the Socket.IO layer.
const client = require("prom-client");

client.collectDefaultMetrics({ prefix: "shedrive_" });

const httpRequestDuration = new client.Histogram({
  name: "shedrive_http_request_duration_seconds",
  help: "HTTP request duration in seconds",
  labelNames: ["method", "route", "status_code"],
  buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],
});

const httpRequestsTotal = new client.Counter({
  name: "shedrive_http_requests_total",
  help: "Total number of HTTP requests",
  labelNames: ["method", "route", "status_code"],
});

// Gauges used by later phases. Defining them now keeps the metric names stable.
const activeSocketConnections = new client.Gauge({
  name: "shedrive_active_socket_connections",
  help: "Number of currently connected Socket.IO clients",
});

const onlineDrivers = new client.Gauge({
  name: "shedrive_online_drivers",
  help: "Number of drivers currently online",
});

const openSosAlerts = new client.Gauge({
  name: "shedrive_open_sos_alerts",
  help: "Number of SOS alerts still marked open",
});

function metricsMiddleware(req, res, next) {
  const end = httpRequestDuration.startTimer();
  res.on("finish", () => {
    // Use the matched route when available so labels stay low-cardinality.
    const route = req.route ? req.baseUrl + req.route.path : req.path;
    const labels = {
      method: req.method,
      route,
      status_code: res.statusCode,
    };
    end(labels);
    httpRequestsTotal.inc(labels);
  });
  next();
}

async function metricsHandler(_req, res) {
  res.set("Content-Type", client.register.contentType);
  res.end(await client.register.metrics());
}

module.exports = {
  register: client.register,
  metricsMiddleware,
  metricsHandler,
  activeSocketConnections,
  onlineDrivers,
  openSosAlerts,
};
