const express = require('express');
const router = express.Router();
const { metricsDb } = require('../../src/config/database');

router.get('/', (req, res) => {
    try {
        const tpmRow = metricsDb.prepare("SELECT max_tpm, max_rpm FROM tpm_state WHERE id = 'singleton'").get();
        const nodesRows = metricsDb.prepare("SELECT * FROM node_metrics").all();
        
        res.json({
            max_tpm: tpmRow ? tpmRow.max_tpm : 0,
            max_rpm: tpmRow ? tpmRow.max_rpm : 0,
            nodes: nodesRows || []
        });
    } catch (e) {
        console.error("Error fetching metrics:", e);
        res.status(500).json({ error: "Internal server error" });
    }
});

module.exports = router;
