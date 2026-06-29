const express = require('express');
const router = express.Router();
const { composeDraftStream, composeSend } = require('../controllers/composeController');

router.post('/draft', composeDraftStream);
router.post('/send', composeSend);

module.exports = router;
