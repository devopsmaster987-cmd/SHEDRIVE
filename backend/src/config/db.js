// MongoDB connection helpers. Kept small so tests can import the Express app
// without opening a database connection.
const mongoose = require("mongoose");
const config = require("./env");

async function connectDb(uri = config.mongoUri) {
  mongoose.set("strictQuery", true);
  await mongoose.connect(uri, {
    serverSelectionTimeoutMS: 8000,
  });
  console.log("[db] connected to MongoDB");
  return mongoose.connection;
}

async function disconnectDb() {
  if (mongoose.connection.readyState !== 0) {
    await mongoose.disconnect();
    console.log("[db] disconnected");
  }
}

module.exports = { connectDb, disconnectDb };
