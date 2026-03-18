'use strict';
const express = require('express');
const { queryOne, queryAll } = require('../../pgdb');
const { requirePartnerAuth } = require('../middleware');
const router = express.Router();

async function getAff(accountId) {
  return queryOne('SELECT id,ref_code,revshare_percent,total_earned,total_paid FROM affiliates WHERE account_id=$1',[accountId]);
}

router.get('/summary', requirePartnerAuth, async (req, res) => {
  try {
    const aff = await getAff(req.partnerAccount.id);
    if (!aff) return res.status(404).json({ error:'Affiliate profile not found' });
    const from = req.query.from||new Date(Date.now()-30*864e5).toISOString().slice(0,10);
    const to   = req.query.to  ||new Date().toISOString().slice(0,10);
    const [stats,clicks,earned] = await Promise.all([
      queryOne(`SELECT COUNT(DISTINCT referred_user_id)::int as regs,COUNT(DISTINCT CASE WHEN first_deposit_date IS NOT NULL THEN referred_user_id END)::int as ftds,COALESCE(SUM(first_deposit_amount),0)::float as deps FROM affiliate_referrals WHERE affiliate_id=$1 AND created_date::date BETWEEN $2 AND $3`,[aff.id,from,to]),
      queryOne(`SELECT COUNT(*)::int as n FROM affiliate_clicks WHERE affiliate_id=$1 AND created_at::date BETWEEN $2 AND $3`,[aff.id,from,to]),
      queryOne(`SELECT COALESCE(SUM(amount),0)::float as n FROM affiliate_commissions WHERE affiliate_id=$1 AND created_at::date BETWEEN $2 AND $3`,[aff.id,from,to]),
    ]);
    const regs=stats?.regs||0, ftds=stats?.ftds||0;
    res.json({ period:{from,to}, clicks:clicks?.n||0, registrations:regs, ftds, conversion_pct:regs>0?+((ftds/regs)*100).toFixed(1):0, total_deposits:stats?.deps||0, earned:earned?.n||0, total_earned:parseFloat(aff.total_earned||0), total_paid:parseFloat(aff.total_paid||0), balance:parseFloat(aff.total_earned||0)-parseFloat(aff.total_paid||0), data_freshness:new Date().toISOString() });
  } catch(e) { console.error('[partners/dashboard]',e.message); res.status(500).json({ error:'Server error' }); }
});

router.get('/timeseries', requirePartnerAuth, async (req, res) => {
  try {
    const aff = await getAff(req.partnerAccount.id);
    if (!aff) return res.json({ series:[] });
    const from = req.query.from||new Date(Date.now()-30*864e5).toISOString().slice(0,10);
    const to   = req.query.to  ||new Date().toISOString().slice(0,10);
    const rows = await queryAll(`SELECT date_trunc('day',created_date)::date as date,COUNT(DISTINCT referred_user_id)::int as registrations,COUNT(DISTINCT CASE WHEN first_deposit_date IS NOT NULL THEN referred_user_id END)::int as ftds FROM affiliate_referrals WHERE affiliate_id=$1 AND created_date::date BETWEEN $2 AND $3 GROUP BY 1 ORDER BY 1`,[aff.id,from,to]);
    res.json({ series:rows, from, to });
  } catch(e) { res.status(500).json({ error:'Server error' }); }
});

module.exports = router;
