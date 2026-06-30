require('dotenv').config();
const logger = require('../src/utils/logger');
const express = require('express');
const cors = require('cors');
const inboxRoutes = require('./routes/inbox');
const trashRoutes = require('./routes/trash');
const starredRoutes = require('./routes/starred');
const sentRoutes = require('./routes/sent');
const spamRoutes = require('./routes/spam');
const draftsRoutes = require('./routes/drafts');
const attentionRoutes = require('./routes/attention');
const workProfessionalRoutes = require('./routes/workProfessional');
const personalSocialRoutes = require('./routes/personalSocial');
const composeRoutes = require('./routes/compose');
const metricsRoutes = require('./routes/metrics');

const app = express();
const PORT = process.env.PORT || 5000;

// Middleware
app.use(cors()); // Allow requests from our future React frontend
app.use(express.json()); // Parse incoming JSON bodies

// API Request Logger Middleware
app.use((req, res, next) => {
    const start = Date.now();
    res.on('finish', () => {
        const ms = Date.now() - start;
        logger.info(`[BFF] ${req.method} ${req.originalUrl} ${res.statusCode} - ${ms}ms`);
    });
    next();
});

// Routes
app.get('/api/', (req, res) => {
    res.redirect('/api/inbox');
});

app.use('/api/inbox', inboxRoutes);
app.use('/api/trash', trashRoutes);
app.use('/api/starred', starredRoutes);
app.use('/api/sent', sentRoutes);
app.use('/api/spam', spamRoutes);
app.use('/api/drafts', draftsRoutes);
app.use('/api/attention', attentionRoutes);
app.use('/api/work-professional', workProfessionalRoutes);
app.use('/api/personal-social', personalSocialRoutes);
app.use('/api/compose', composeRoutes);
app.use('/api/token_info', metricsRoutes);

// Start Server
app.listen(PORT, () => {
    logger.info(`=========================================`);
    logger.info(`[BFF SERVER] Express running on port ${PORT}`);
    logger.info(`[BFF SERVER] Test endpoint: http://localhost:${PORT}/api/inbox`);
    logger.info(`=========================================`);
});
