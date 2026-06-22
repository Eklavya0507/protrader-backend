const express = require("express");

const {
  getSettings,
  updateSettings,
  resetSettings,
} = require("../controllers/settingController");

const router = express.Router();

router.route("/").get(getSettings).put(updateSettings);
router.post("/reset", resetSettings);

module.exports = router;
