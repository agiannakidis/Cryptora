'use strict';
const express = require('express');
const { queryOne, queryAll } = require('../../pgdb');
const { requirePartnerAuth } = require('../middleware');
const router = express.Router();
router.get('/', requirePartnerAuth, async (req, res) => {
  try {
    const aff=await queryOne('SELECT id FROM affiliates WHERE account_id=$1',[req.partnerAccount.id]);
    if(!aff) return res.json({commissions:[],total:0});
    const limit=Math.min(parseInt(req.query.limit)||20,100), offset=parseInt(req.query.offset)||0;
    const rows=await queryAll('SELECT id,amount,status,period_start,period_end,revshare_percent,ngr,created_at,paid_at FROM affiliate_commissions WHERE affiliate_id=$1 ORDER BY created_at DESC LIMIT $2 OFFSET $3',[aff.id,limit,offset]);
    const cnt=await queryOne('SELECT COUNT(*)::int as n FROM affiliate_commissions WHERE affiliate_id=$1',[aff.id]);
    res.json({ commissions:rows.map(r=>({...r,amount:parseFloat(r.amount||0),ngr:parseFloat(r.ngr||0)})), total:cnt?.n||0, limit, offset });
  } catch(e) { res.status(500).json({ error:'Server error' }); }
});
module.exports = router;
