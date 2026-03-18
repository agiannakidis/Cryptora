'use strict';
const express = require('express');
const { queryOne, queryAll } = require('../../pgdb');
const { requirePartnerAuth } = require('../middleware');
const router = express.Router();
router.get('/', requirePartnerAuth, async (req, res) => {
  try {
    const aff = await queryOne('SELECT id FROM affiliates WHERE account_id=$1',[req.partnerAccount.id]);
    if (!aff) return res.json({ players:[],total:0 });
    const limit=Math.min(parseInt(req.query.limit)||20,100), offset=parseInt(req.query.offset)||0;
    const search=req.query.search||'';
    const params=[aff.id,limit,offset];
    let w='';
    if(search){params.push('%'+search.toLowerCase()+'%');w=` AND LOWER(ar.referred_user_email) LIKE $${params.length}`;}
    const rows=await queryAll(`SELECT ar.referred_user_id as id,ar.referred_user_email,ar.status,ar.created_date as registered_at,ar.first_deposit_at,ar.first_deposit_amount,ar.sub1,ar.sub2 FROM affiliate_referrals ar WHERE ar.affiliate_id=$1${w} ORDER BY ar.created_date DESC LIMIT $2 OFFSET $3`,params);
    const cnt=await queryOne(`SELECT COUNT(*)::int as n FROM affiliate_referrals WHERE affiliate_id=$1`,[aff.id]);
    res.json({ players:rows.map(r=>({...r,referred_user_email:r.referred_user_email?r.referred_user_email.replace(/^(.{2}).*(@.*)$/,'$1***$2'):'—',first_deposit_amount:parseFloat(r.first_deposit_amount||0)})), total:cnt?.n||0, limit, offset });
  } catch(e) { res.status(500).json({ error:'Server error' }); }
});
module.exports = router;
