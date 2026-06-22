const express = require("express");

const {
  createTrade,
  getTrades,
  getTradeById,
  updateTrade,
  deleteTrade,
} = require("../controllers/tradeController");

const { protect } = require("../middleware/authMiddleware");

const router = express.Router();

router.use(protect);

router.route("/").post(createTrade).get(getTrades);

router
  .route("/:id")
  .get(getTradeById)
  .put(updateTrade)
  .delete(deleteTrade);

module.exports = router;
