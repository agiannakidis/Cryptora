'use strict';
const express = require('express');
const { queryOne, query } = require('../../pgdb');
const { requirePartnerAuth, logAudit } = require('../middleware');
const router = express.Router();
router.get('/', requirePartnerAuth, async (req,res) => {
  try {
    const [acc,aff]=await Promise.all([
      queryOne('SELECT id,email,totp_enabled,created_at,updated_at FROM affiliate_accounts WHERE id=$1',[req.partnerAccount.id]),
      queryOne('SELECT ref_code,commission_type,revshare_percent,cpa_amount,postback_url,total_earned,total_paid FROM affiliates WHERE account_id=$1',[req.partnerAccount.id]),
    ]);
    res.json({account:acc,affiliate:aff});
  } catch(e) { res.status(500).json({error:'Server error'}); }
});
router.patch('/payout', requirePartnerAuth, async (req,res) => {
  const {wallet_address,chain,payout_method}=req.body||{};
  try {
    await query('UPDATE affiliates SET payout_wallet=$1,payout_chain=$2,payout_method=$3,updated_at=NOW() WHERE account_id=$4',[wallet_address,chain,payout_method,req.partnerAccount.id]);
    await logAudit(req.partnerAccount.id,'payout_wallet_changed',req.ip,{chain});
    res.json({ok:true});
  } catch(e) { res.status(500).json({error:'Server error'}); }
});
module.exports = router;
