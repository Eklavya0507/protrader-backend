const mongoose = require("mongoose");

const tradeSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: [true, "Trade owner is required"],
      index: true,
    },

    symbol: {
      type: String,
      required: [true, "Symbol is required"],
      trim: true,
      uppercase: true,
    },

    tradeDate: {
      type: Date,
      required: [true, "Trade date is required"],
    },

    entryTime: {
      type: String,
      trim: true,
    },

    exitTime: {
      type: String,
      trim: true,
    },

    session: {
      type: String,
      enum: ["Asian", "London", "New York", "Other"],
      default: "Other",
    },

    model: {
      type: String,
      trim: true,
    },

    protocol: {
      type: String,
      trim: true,
    },

    direction: {
      type: String,
      required: [true, "Direction is required"],
      enum: ["Long", "Short"],
    },

    entryPrice: {
      type: Number,
      required: [true, "Entry price is required"],
    },

    exitPrice: {
      type: Number,
    },

    stopLoss: {
      type: Number,
    },

    takeProfit: {
      type: Number,
    },

    commission: {
      type: Number,
      default: 0,
      min: 0,
    },

    quantity: {
      type: Number,
      default: 1,
      min: 0,
    },

    profitLoss: {
      type: Number,
      default: 0,
    },

    rr: {
      type: Number,
      default: 0,
    },

    result: {
      type: String,
      enum: ["Win", "Loss", "Breakeven", "Open"],
      default: "Open",
    },

    rating: {
      type: Number,
      min: 1,
      max: 5,
    },

    checklist: [
      {
        type: String,
        trim: true,
      },
    ],

    mistakeTags: [
      {
        type: String,
        trim: true,
      },
    ],

    notes: {
      type: String,
      trim: true,
      maxlength: 5000,
    },

    screenshotUrl: {
      type: String,
      default: "",
    },
  },
  {
    timestamps: true,
  }
);

tradeSchema.index({ user: 1, tradeDate: -1, createdAt: -1 });

module.exports = mongoose.model("Trade", tradeSchema);
