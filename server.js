const dns = require("node:dns");

// Windows local DNS workaround.
// Render automatically uses NODE_ENV=production, so this won't run there.
if (process.env.NODE_ENV !== "production") {
  dns.setServers(["8.8.8.8", "8.8.4.4"]);
}

const express = require("express");
const cors = require("cors");
const dotenv = require("dotenv");

dotenv.config();

const connectDB = require("./config/db");
const tradeRoutes = require("./routes/tradeRoutes");
const journalRoutes = require("./routes/journalRoutes");
const settingRoutes = require("./routes/settingRoutes");
const authRoutes = require("./routes/authRoutes");

const app = express();

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Main route
app.get("/", (req, res) => {
  res.status(200).json({
    success: true,
    message: "ProTrade Backend Running",
  });
});

// Render health check route
app.get("/api/health", (req, res) => {
  res.status(200).json({
    success: true,
    server: "running",
    database: "connected",
  });
});

// API routes
app.use("/api/trades", tradeRoutes);
app.use("/api/journals", journalRoutes);
app.use("/api/settings", settingRoutes);
app.use("/api/auth", authRoutes);

// 404 handler
app.use((req, res) => {
  res.status(404).json({
    success: false,
    message: `Route not found: ${req.method} ${req.originalUrl}`,
  });
});

const PORT = process.env.PORT || 5000;

const startServer = async () => {
  try {
    await connectDB();

    app.listen(PORT, "0.0.0.0", () => {
      console.log(`Server running on port ${PORT}`);
    });
  } catch (error) {
    console.error("Server startup failed:");
    console.error(error.message);
    process.exit(1);
  }
};

startServer();
