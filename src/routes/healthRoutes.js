const express = require('express');

const router = express.Router();

router.get('/', (req, res) => {
  res.json({
    ok: true,
    service: 'ihomis-forms-backend',
    uptimeSeconds: process.uptime(),
    timestamp: new Date().toISOString(),
  });
});

module.exports = router;
