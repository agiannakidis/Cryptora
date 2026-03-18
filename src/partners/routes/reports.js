'use strict';
const express = require('express');
const { queryOne, queryAll } = require('../../pgdb');
const { requirePartnerAuth } = require('../middleware');
const router = express.Router();
router.get('/performance', requirePartnerAuth, async (req,res) => {
  try {
    const aff=await queryOne('SELECT id FROM affiliates WHERE account_id=$1',[req.partnerAccount.id]);
    if(!aff) return res.json({rows:[],total:0});
    const from=req.query.from||new Date(Date.now()-30*864e5).toISOString().slice(0,10);
    const to=req.query.to||new Date().toISOString().slice(0,10);
    const limit=Math.min(parseInt(req.query.limit)||50,500), offset=parseInt(req.query.offset)||0;
    const rows=await queryAll(`SELECT created_date::date as date,COUNT(DISTINCT referred_user_id)::int as registrations,COUNT(DISTINCT CASE WHEN first_deposit_date IS NOT NULL THEN referred_user_id END)::int as ftds,COALESCE(SUM(first_deposit_amount),0)::float as deposits FROM affiliate_referrals WHERE affiliate_id=$1 AND created_date::date BETWEEN $2 AND $3 GROUP BY 1 ORDER BY 1 DESC LIMIT $4 OFFSET $5`,[aff.id,from,to,limit,offset]);
    res.json({rows,total:rows.length,from,to});
  } catch(e) { res.status(500).json({error:'Server error'}); }
});
module.exports = router;
