require("../dns-fix.cjs");
const http = require("node:http");
const app = require("./app");
const config = require("./config/env");
const { connectDb, disconnectDb } = require("./config/db");
const { attachSockets, configureRealtimeAdapter } = require("./sockets");

async function start() {
  try {
    await connectDb();

    const server = http.createServer(app);
    const io = attachSockets(server);
    const closeRealtimeAdapter = await configureRealtimeAdapter(io);

    server.listen(config.port, () => {
      console.log(`[server] SheDrive backend listening on port ${config.port}`);
    });

    async function shutdown(signal) {
      console.log(`[server] received ${signal}, shutting down...`);
      io.close(async () => {
        try {
          await closeRealtimeAdapter();
          await disconnectDb();
        } finally {
          process.exit(0);
        }
      });

      // Do not hang forever on stuck connections.
      setTimeout(() => process.exit(1), 10000).unref();
    }

    process.on("SIGINT", () => shutdown("SIGINT"));
    process.on("SIGTERM", () => shutdown("SIGTERM"));
  } catch (error) {
    console.error("[server] failed to start:", error.message);
    process.exit(1);
  }
}

start();
