const mongoose = require("mongoose");
const Journal = require("../models/Journal");
const Trade = require("../models/Trade");

const populateTrade = {
  path: "trade",
  select:
    "symbol tradeDate direction result profitLoss rr rating session model protocol",
};

const escapeRegex = (value = "") =>
  value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const normalizeBody = (body = {}) => {
  const normalized = { ...body };

  if (normalized.tradeId && !normalized.trade) {
    normalized.trade = normalized.tradeId;
  }

  delete normalized.tradeId;
  delete normalized.user;
  delete normalized._id;

  if (Array.isArray(normalized.mistakes)) {
    normalized.mistakes = normalized.mistakes
      .map((item) => String(item).trim())
      .filter(Boolean);
  }

  if (Array.isArray(normalized.tags)) {
    normalized.tags = normalized.tags
      .map((item) => String(item).trim())
      .filter(Boolean);
  }

  return normalized;
};

const validateTrade = async (tradeId, userId) => {
  if (!tradeId) return { valid: true, trade: null };

  if (!mongoose.isValidObjectId(tradeId)) {
    return { valid: false, status: 400, message: "Invalid trade ID" };
  }

  const trade = await Trade.findOne({
    _id: tradeId,
    user: userId,
  }).select("symbol");

  if (!trade) {
    return {
      valid: false,
      status: 404,
      message: "Linked trade not found in your account",
    };
  }

  return { valid: true, trade };
};

// POST /api/journals
const createJournal = async (req, res) => {
  try {
    const body = normalizeBody(req.body);
    const tradeValidation = await validateTrade(body.trade, req.user._id);

    if (!tradeValidation.valid) {
      return res.status(tradeValidation.status).json({
        success: false,
        message: tradeValidation.message,
      });
    }

    if (body.trade && !body.symbol) {
      body.symbol = tradeValidation.trade?.symbol || "";
    }

    const journal = await Journal.create({
      ...body,
      user: req.user._id,
    });

    await journal.populate(populateTrade);

    res.status(201).json({
      success: true,
      message: "Journal entry created successfully",
      data: journal,
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      message: error.message,
    });
  }
};

// GET /api/journals
const getJournals = async (req, res) => {
  try {
    const { trade, entryType, status, search } = req.query;
    const filter = { user: req.user._id };

    if (trade) {
      if (!mongoose.isValidObjectId(trade)) {
        return res.status(400).json({
          success: false,
          message: "Invalid trade ID",
        });
      }

      const tradeValidation = await validateTrade(trade, req.user._id);

      if (!tradeValidation.valid) {
        return res.status(tradeValidation.status).json({
          success: false,
          message: tradeValidation.message,
        });
      }

      filter.trade = trade;
    }

    if (entryType) filter.entryType = entryType;
    if (status) filter.status = status;

    if (search && search.trim()) {
      const searchRegex = new RegExp(escapeRegex(search.trim()), "i");
      filter.$or = [
        { title: searchRegex },
        { symbol: searchRegex },
        { summary: searchRegex },
        { reflection: searchRegex },
        { lessons: searchRegex },
        { actionPlan: searchRegex },
        { mistakes: searchRegex },
        { tags: searchRegex },
      ];
    }

    const journals = await Journal.find(filter)
      .populate(populateTrade)
      .sort({ journalDate: -1, createdAt: -1 });

    res.status(200).json({
      success: true,
      count: journals.length,
      data: journals,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

// GET /api/journals/stats
const getJournalStats = async (req, res) => {
  try {
    const [stats] = await Journal.aggregate([
      {
        $match: {
          user: req.user._id,
        },
      },
      {
        $group: {
          _id: null,
          total: { $sum: 1 },
          completed: {
            $sum: {
              $cond: [{ $eq: ["$status", "Completed"] }, 1, 0],
            },
          },
          drafts: {
            $sum: {
              $cond: [{ $eq: ["$status", "Draft"] }, 1, 0],
            },
          },
          linkedTrades: {
            $sum: {
              $cond: [{ $ne: ["$trade", null] }, 1, 0],
            },
          },
          averageConfidence: { $avg: "$confidence" },
          averageDiscipline: { $avg: "$discipline" },
        },
      },
    ]);

    const data = stats || {
      total: 0,
      completed: 0,
      drafts: 0,
      linkedTrades: 0,
      averageConfidence: 0,
      averageDiscipline: 0,
    };

    delete data._id;

    data.averageConfidence = Number(
      (data.averageConfidence || 0).toFixed(2)
    );
    data.averageDiscipline = Number(
      (data.averageDiscipline || 0).toFixed(2)
    );

    res.status(200).json({
      success: true,
      data,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

// GET /api/journals/:id
const getJournalById = async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid journal ID",
      });
    }

    const journal = await Journal.findOne({
      _id: req.params.id,
      user: req.user._id,
    }).populate(populateTrade);

    if (!journal) {
      return res.status(404).json({
        success: false,
        message: "Journal entry not found",
      });
    }

    res.status(200).json({
      success: true,
      data: journal,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

// PUT /api/journals/:id
const updateJournal = async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid journal ID",
      });
    }

    const body = normalizeBody(req.body);

    if (Object.prototype.hasOwnProperty.call(body, "trade")) {
      const tradeValidation = await validateTrade(body.trade, req.user._id);

      if (!tradeValidation.valid) {
        return res.status(tradeValidation.status).json({
          success: false,
          message: tradeValidation.message,
        });
      }

      if (body.trade && !body.symbol) {
        body.symbol = tradeValidation.trade?.symbol || "";
      }
    }

    const journal = await Journal.findOneAndUpdate(
      {
        _id: req.params.id,
        user: req.user._id,
      },
      body,
      {
        new: true,
        runValidators: true,
      }
    ).populate(populateTrade);

    if (!journal) {
      return res.status(404).json({
        success: false,
        message: "Journal entry not found",
      });
    }

    res.status(200).json({
      success: true,
      message: "Journal entry updated successfully",
      data: journal,
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      message: error.message,
    });
  }
};

// DELETE /api/journals/:id
const deleteJournal = async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid journal ID",
      });
    }

    const journal = await Journal.findOneAndDelete({
      _id: req.params.id,
      user: req.user._id,
    });

    if (!journal) {
      return res.status(404).json({
        success: false,
        message: "Journal entry not found",
      });
    }

    res.status(200).json({
      success: true,
      message: "Journal entry deleted successfully",
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

module.exports = {
  createJournal,
  getJournals,
  getJournalStats,
  getJournalById,
  updateJournal,
  deleteJournal,
};
