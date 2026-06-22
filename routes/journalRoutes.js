const express = require("express");

const {
  createJournal,
  getJournals,
  getJournalStats,
  getJournalById,
  updateJournal,
  deleteJournal,
} = require("../controllers/journalController");

const { protect } = require("../middleware/authMiddleware");

const router = express.Router();

router.use(protect);

router.route("/").post(createJournal).get(getJournals);

// Keep /stats before /:id so Express does not treat "stats" as an ID.
router.get("/stats", getJournalStats);

router
  .route("/:id")
  .get(getJournalById)
  .put(updateJournal)
  .delete(deleteJournal);

module.exports = router;
