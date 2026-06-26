const express = require('express');
const router = express.Router();

// The compose route for creating brand new emails (Phase 7)
router.get('/', (req, res) => {
    res.json({ message: "Page under maintenance" });
});

module.exports = router;
