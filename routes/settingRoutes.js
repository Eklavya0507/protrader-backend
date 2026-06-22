const express = require("express");

const {
  getSettings,
  updateSettings,
  resetSettings,
} = require("../controllers/settingController");

const { protect } = require("../middleware/authMiddleware");

const router = express.Router();

router.use(protect);

router.route("/").get(getSettings).put(updateSettings);
router.post("/reset", resetSettings);

module.exports = router;
