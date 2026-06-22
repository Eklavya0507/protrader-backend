const mongoose = require("mongoose");
const Trade = require("../models/Trade");

const cleanUpdates = (body = {}) => {
  const updates = { ...body };
  delete updates.user;
  delete updates._id;
  return updates;
};

// POST /api/trades
const createTrade = async (req, res) => {
  try {
    const trade = await Trade.create({
      ...cleanUpdates(req.body),
      user: req.user._id,
    });

    res.status(201).json({
      success: true,
      message: "Trade created successfully",
      data: trade,
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      message: error.message,
    });
  }
};

// GET /api/trades
const getTrades = async (req, res) => {
  try {
    const trades = await Trade.find({ user: req.user._id }).sort({
      tradeDate: -1,
      createdAt: -1,
    });

    res.status(200).json({
      success: true,
      count: trades.length,
      data: trades,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

// GET /api/trades/:id
const getTradeById = async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid trade ID",
      });
    }

    const trade = await Trade.findOne({
      _id: req.params.id,
      user: req.user._id,
    });

    if (!trade) {
      return res.status(404).json({
        success: false,
        message: "Trade not found",
      });
    }

    res.status(200).json({
      success: true,
      data: trade,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

// PUT /api/trades/:id
const updateTrade = async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid trade ID",
      });
    }

    const trade = await Trade.findOneAndUpdate(
      {
        _id: req.params.id,
        user: req.user._id,
      },
      cleanUpdates(req.body),
      {
        new: true,
        runValidators: true,
      }
    );

    if (!trade) {
      return res.status(404).json({
        success: false,
        message: "Trade not found",
      });
    }

    res.status(200).json({
      success: true,
      message: "Trade updated successfully",
      data: trade,
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      message: error.message,
    });
  }
};

// DELETE /api/trades/:id
const deleteTrade = async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid trade ID",
      });
    }

    const trade = await Trade.findOneAndDelete({
      _id: req.params.id,
      user: req.user._id,
    });

    if (!trade) {
      return res.status(404).json({
        success: false,
        message: "Trade not found",
      });
    }

    res.status(200).json({
      success: true,
      message: "Trade deleted successfully",
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

module.exports = {
  createTrade,
  getTrades,
  getTradeById,
  updateTrade,
  deleteTrade,
};
