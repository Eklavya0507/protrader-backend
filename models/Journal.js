const mongoose = require("mongoose");

const aiReviewSchema = new mongoose.Schema(
  {
    summary: {
      type: String,
      trim: true,
      maxlength: 3000,
      default: "",
    },
    strengths: {
      type: [String],
      default: [],
    },
    weaknesses: {
      type: [String],
      default: [],
    },
    suggestions: {
      type: [String],
      default: [],
    },
    score: {
      type: Number,
      min: 0,
      max: 100,
      default: null,
    },
    generatedAt: {
      type: Date,
      default: null,
    },
  },
  { _id: false }
);

const journalSchema = new mongoose.Schema(
  {
    title: {
      type: String,
      required: [true, "Journal title is required"],
      trim: true,
      maxlength: [150, "Title cannot exceed 150 characters"],
    },

    journalDate: {
      type: Date,
      default: Date.now,
    },

    entryType: {
      type: String,
      enum: [
        "Trade Review",
        "Daily Review",
        "Weekly Review",
        "Free Note",
      ],
      default: "Trade Review",
    },

    trade: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Trade",
      default: null,
    },

    symbol: {
      type: String,
      trim: true,
      uppercase: true,
      maxlength: 30,
      default: "",
    },

    summary: {
      type: String,
      trim: true,
      maxlength: 3000,
      default: "",
    },

    reflection: {
      type: String,
      trim: true,
      maxlength: 6000,
      default: "",
    },

    lessons: {
      type: String,
      trim: true,
      maxlength: 4000,
      default: "",
    },

    mistakes: {
      type: [String],
      default: [],
    },

    actionPlan: {
      type: String,
      trim: true,
      maxlength: 4000,
      default: "",
    },

    mood: {
      type: String,
      enum: [
        "Calm",
        "Confident",
        "Neutral",
        "Anxious",
        "Frustrated",
        "Excited",
        "Tired",
      ],
      default: "Neutral",
    },

    confidence: {
      type: Number,
      min: 1,
      max: 10,
      default: 5,
    },

    discipline: {
      type: Number,
      min: 1,
      max: 10,
      default: 5,
    },

    tags: {
      type: [String],
      default: [],
    },

    status: {
      type: String,
      enum: ["Draft", "Completed"],
      default: "Draft",
    },

    aiReview: {
      type: aiReviewSchema,
      default: () => ({}),
    },
  },
  {
    timestamps: true,
  }
);

journalSchema.index({ journalDate: -1, createdAt: -1 });
journalSchema.index({ trade: 1 });
journalSchema.index({
  title: "text",
  summary: "text",
  reflection: "text",
  lessons: "text",
  actionPlan: "text",
  tags: "text",
});

module.exports = mongoose.model("Journal", journalSchema);
