const dns = require("node:dns");

// Windows local DNS workaround.
// Render automatically uses NODE_ENV=production, so this will not run there.
if (process.env.NODE_ENV !== "production") {
  dns.setServers(["8.8.8.8", "8.8.4.4"]);
}

const express = require("express");
const cors = require("cors");
const dotenv = require("dotenv");
const helmet = require("helmet");

dotenv.config();

const connectDB = require("./config/db");
const tradeRoutes = require("./routes/tradeRoutes");
const journalRoutes = require("./routes/journalRoutes");
const settingRoutes = require("./routes/settingRoutes");
const authRoutes = require("./routes/authRoutes");
const accountRoutes = require("./routes/accountRoutes");
const securityRoutes = require("./routes/securityRoutes");
const securityAlertRoutes = require("./routes/securityAlertRoutes");

const {
  requestId,
  validateRequestInput,
} = require("./middleware/requestSecurity");

const {
  apiRateLimiter,
} = require("./middleware/apiRateLimiter");

const {
  notFoundHandler,
  errorHandler,
} = require("./middleware/errorHandler");
const {
  securityActivityLogger,
} = require("./middleware/securityActivityLogger");

const app = express();

const isProduction = process.env.NODE_ENV === "production";
const requestBodyLimit =
  String(process.env.REQUEST_BODY_LIMIT || "1mb").trim() || "1mb";

// Render places the service behind one trusted reverse-proxy hop.
// This keeps req.ip accurate for rate limiting without trusting arbitrary hops.
if (isProduction) {
  app.set("trust proxy", 1);
}

app.disable("x-powered-by");

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

    const error = new Error("Origin not allowed by CORS");
    error.code = "CORS_NOT_ALLOWED";
    return callback(error);
  },
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: [
    "Content-Type",
    "Authorization",
    "X-Client-Timezone",
    "X-Client-Device-Id",
  ],
  optionsSuccessStatus: 204,
  maxAge: 86400,
};

app.use(requestId);

app.use(
  helmet({
    // The frontend is hosted on GitHub Pages and consumes this JSON API.
    crossOriginResourcePolicy: { policy: "cross-origin" },
  })
);

app.use(cors(corsOptions));

// General protection for every API endpoint. Login also keeps its stricter
// Batch 1 limiter inside routes/authRoutes.js.
app.use("/api", apiRateLimiter);

app.use(
  express.json({
    limit: requestBodyLimit,
    strict: true,
    type: ["application/json", "application/*+json"],
  })
);

app.use(
  express.urlencoded({
    extended: false,
    limit: requestBodyLimit,
    parameterLimit: 200,
  })
);

app.use(validateRequestInput);
app.use(securityActivityLogger);

app.get("/", (req, res) => {
  res.status(200).json({
    success: true,
    message: "ProTrade Backend Running",
    requestId: req.requestId,
  });
});

app.get("/api/health", (req, res) => {
  res.status(200).json({
    success: true,
    server: "running",
    database: "connected",
    requestId: req.requestId,
  });
});

app.use("/api/trades", tradeRoutes);
app.use("/api/journals", journalRoutes);
app.use("/api/settings", settingRoutes);
app.use("/api/auth", authRoutes);
app.use("/api/account", accountRoutes);
app.use("/api/security/alerts", securityAlertRoutes);
app.use("/api/security", securityRoutes);

app.use(notFoundHandler);
app.use(errorHandler);

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
