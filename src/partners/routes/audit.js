'use strict';
const express = require('express');
const { queryAll } = require('../../pgdb');
const { requirePartnerAuth } = require('../middleware');
const router = express.Router();
router.get('/', requirePartnerAuth, async (req,res) => {
  try {
    const rows=await queryAll('SELECT action,ip_address,meta,created_at FROM affiliate_audit_logs WHERE account_id=$1 ORDER BY created_at DESC LIMIT 50',[req.partnerAccount.id]);
    res.json({events:rows});
  } catch(e) { res.json({events:[],note:'Unavailable'}); }
});
module.exports = router;
