const dns = require("node:dns");

// Windows local DNS workaround.
// Render automatically uses NODE_ENV=production, so this will not run there.
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

const allowedOrigins = [
  "https://eklavya0507.github.io",
  "http://127.0.0.1:5500",
  "http://localhost:5500",
];

const corsOptions = {
  origin(origin, callback) {
    if (!origin || allowedOrigins.includes(origin)) {
      return callback(null, true);
    }

    return callback(new Error("Origin not allowed by CORS"));
  },
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: [
    "Content-Type",
    "Authorization",
    "X-Client-Timezone",
  ],
};

app.use(cors(corsOptions));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.get("/", (req, res) => {
  res.status(200).json({
    success: true,
    message: "ProTrade Backend Running",
  });
});

app.get("/api/health", (req, res) => {
  res.status(200).json({
    success: true,
    server: "running",
    database: "connected",
  });
});

app.use("/api/trades", tradeRoutes);
app.use("/api/journals", journalRoutes);
app.use("/api/settings", settingRoutes);
app.use("/api/auth", authRoutes);

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
