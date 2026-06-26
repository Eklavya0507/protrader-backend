const crypto = require("node:crypto");

const positiveInteger = (value, fallback) => {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
};

const MAX_DEPTH = positiveInteger(
  process.env.REQUEST_MAX_DEPTH,
  12
);

const MAX_KEYS = positiveInteger(
  process.env.REQUEST_MAX_KEYS,
  500
);

const MAX_ARRAY_ITEMS = positiveInteger(
  process.env.REQUEST_MAX_ARRAY_ITEMS,
  1000
);

const MAX_STRING_LENGTH = positiveInteger(
  process.env.REQUEST_MAX_STRING_LENGTH,
  250000
);

const forbiddenKeys = new Set([
  "__proto__",
  "prototype",
  "constructor",
]);

const requestId = (req, res, next) => {
  const incomingId = String(req.headers["x-request-id"] || "").trim();

  req.requestId =
    /^[a-zA-Z0-9._:-]{8,100}$/.test(incomingId)
      ? incomingId
      : crypto.randomUUID();

  res.set("X-Request-Id", req.requestId);
  next();
};

const validationError = (message, path) => {
  const error = new Error(message);
  error.statusCode = 400;
  error.code = "INVALID_REQUEST_INPUT";
  error.publicMessage = message;
  error.inputPath = path;
  return error;
};

const inspectValue = (
  value,
  path,
  depth,
  state,
  ancestors
) => {
  if (depth > MAX_DEPTH) {
    throw validationError(
      `Request data is nested too deeply at ${path}.`,
      path
    );
  }

  if (typeof value === "string") {
    if (value.length > MAX_STRING_LENGTH) {
      throw validationError(
        `Text value is too long at ${path}.`,
        path
      );
    }

    if (value.includes("\u0000")) {
      throw validationError(
        `Null characters are not allowed at ${path}.`,
        path
      );
    }

    return;
  }

  if (
    value === null ||
    value === undefined ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return;
  }

  if (typeof value !== "object") {
    throw validationError(
      `Unsupported value type at ${path}.`,
      path
    );
  }

  if (ancestors.has(value)) {
    throw validationError(
      `Circular request data is not allowed at ${path}.`,
      path
    );
  }

  ancestors.add(value);

  if (Array.isArray(value)) {
    if (value.length > MAX_ARRAY_ITEMS) {
      throw validationError(
        `Too many items at ${path}.`,
        path
      );
    }

    value.forEach((item, index) => {
      inspectValue(
        item,
        `${path}[${index}]`,
        depth + 1,
        state,
        ancestors
      );
    });

    ancestors.delete(value);
    return;
  }

  for (const [key, child] of Object.entries(value)) {
    state.keyCount += 1;

    if (state.keyCount > MAX_KEYS) {
      throw validationError(
        "Request contains too many fields.",
        path
      );
    }

    if (
      forbiddenKeys.has(key) ||
      key.startsWith("$") ||
      key.includes(".")
    ) {
      throw validationError(
        `Unsafe field name is not allowed at ${path}.${key}.`,
        `${path}.${key}`
      );
    }

    inspectValue(
      child,
      `${path}.${key}`,
      depth + 1,
      state,
      ancestors
    );
  }

  ancestors.delete(value);
};

const validateContainer = (value, label) => {
  if (value === undefined || value === null) {
    return;
  }

  inspectValue(
    value,
    label,
    0,
    { keyCount: 0 },
    new WeakSet()
  );
};

const validateRequestInput = (req, res, next) => {
  try {
    validateContainer(req.body, "body");
    validateContainer(req.params, "params");
    validateContainer(req.query, "query");
    next();
  } catch (error) {
    next(error);
  }
};

module.exports = {
  requestId,
  validateRequestInput,
};
