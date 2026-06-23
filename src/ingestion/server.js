require('dotenv').config();
const express = require('express');
const webhookRoutes = require('./routes');
const path = require('path');

const app = express();
const port = process.env.PORT || 3000;

app.use(express.json());

// Expose webhook routes
app.use('/', webhookRoutes);

app.listen(port, () => {
    console.log(`[SERVER] Ingestion Node running on port ${port}`);
    console.log(`[SERVER] Waiting for webhooks on:`);
    console.log(`  - /webhooks/gmail`);
    console.log(`  - /webhooks/graph`);
});
