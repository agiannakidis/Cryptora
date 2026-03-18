'use strict';
const express = require('express');
const router = express.Router();

router.use('/auth',          require('./routes/auth'));
router.use('/dashboard',     require('./routes/dashboard'));
router.use('/reports',       require('./routes/reports'));
router.use('/players',       require('./routes/players'));
router.use('/commissions',   require('./routes/commissions'));
router.use('/payments',      require('./routes/payments'));
router.use('/tracking',      require('./routes/tracking'));
router.use('/postbacks',     require('./routes/postbacks'));
router.use('/api-keys',      require('./routes/apikeys'));
router.use('/notifications', require('./routes/notifications'));
router.use('/settings',      require('./routes/settings'));
router.use('/audit',         require('./routes/audit'));

module.exports = router;
