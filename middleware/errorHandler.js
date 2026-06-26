const isProduction = process.env.NODE_ENV === "production";

const notFoundHandler = (req, res) => {
  res.status(404).json({
    success: false,
    code: "ROUTE_NOT_FOUND",
    message: "Route not found.",
    requestId: req.requestId,
  });
};

const sendError = (
  res,
  req,
  status,
  code,
  message,
  extra = {}
) => {
  res.status(status).json({
    success: false,
    code,
    message,
    requestId: req.requestId,
    ...extra,
  });
};

const errorHandler = (error, req, res, next) => {
  if (res.headersSent) {
    return next(error);
  }

  const requestId = req.requestId || "unknown";

  if (error?.code === "CORS_NOT_ALLOWED") {
    return sendError(
      res,
      req,
      403,
      "CORS_NOT_ALLOWED",
      "This website origin is not allowed."
    );
  }

  if (
    error?.type === "entity.too.large" ||
    error?.status === 413
  ) {
    return sendError(
      res,
      req,
      413,
      "REQUEST_TOO_LARGE",
      "Request body is too large."
    );
  }

  if (
    error instanceof SyntaxError &&
    error?.status === 400 &&
    "body" in error
  ) {
    return sendError(
      res,
      req,
      400,
      "INVALID_JSON",
      "Request body contains invalid JSON."
    );
  }

  if (error?.code === "INVALID_REQUEST_INPUT") {
    return sendError(
      res,
      req,
      error.statusCode || 400,
      error.code,
      error.publicMessage || "Request input is invalid.",
      error.inputPath ? { inputPath: error.inputPath } : {}
    );
  }

  if (error?.name === "ValidationError") {
    return sendError(
      res,
      req,
      400,
      "VALIDATION_FAILED",
      "Submitted data is invalid.",
      {
        fields: Object.keys(error.errors || {}).slice(0, 30),
      }
    );
  }

  if (error?.name === "CastError") {
    return sendError(
      res,
      req,
      400,
      "INVALID_IDENTIFIER",
      "A supplied identifier is invalid."
    );
  }

  if (error?.code === 11000) {
    return sendError(
      res,
      req,
      409,
      "DUPLICATE_VALUE",
      "A record with this value already exists."
    );
  }

  const explicitStatus =
    Number(error?.statusCode) || Number(error?.status);

  if (
    Number.isInteger(explicitStatus) &&
    explicitStatus >= 400 &&
    explicitStatus < 500
  ) {
    return sendError(
      res,
      req,
      explicitStatus,
      error?.code || "REQUEST_FAILED",
      error?.publicMessage ||
        (isProduction ? "The request could not be completed." : error.message)
    );
  }

  console.error(`[${requestId}] Unhandled request error:`);
  console.error(error?.stack || error?.message || error);

  return sendError(
    res,
    req,
    500,
    "INTERNAL_SERVER_ERROR",
    isProduction
      ? "Something went wrong. Please try again later."
      : error?.message || "Internal server error."
  );
};

module.exports = {
  notFoundHandler,
  errorHandler,
};
