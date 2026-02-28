const express = require('express');
const router = express.Router();

// Base44-compatible app public settings endpoint
// GET /api/apps/public/prod/public-settings/by-id/:appId
router.get('/public/prod/public-settings/by-id/:appId', (req, res) => {
  res.json({
    id: req.params.appId,
    public_settings: {
      auth_required: false,
      registration_enabled: true,
    }
  });
});

module.exports = router;
