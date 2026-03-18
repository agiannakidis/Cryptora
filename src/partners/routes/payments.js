'use strict';
const express = require('express');
const { queryOne, queryAll, query } = require('../../pgdb');
const { requirePartnerAuth, logAudit } = require('../middleware');
const { v4:uuidv4 } = require('uuid');
const router = express.Router();
router.get('/', requirePartnerAuth, async (req,res) => {
  try {
    const aff=await queryOne('SELECT id FROM affiliates WHERE account_id=$1',[req.partnerAccount.id]);
    if(!aff) return res.json({payments:[],total:0});
    const rows=await queryAll('SELECT * FROM affiliate_payout_requests WHERE affiliate_id=$1 ORDER BY created_at DESC LIMIT 50',[aff.id]);
    res.json({payments:rows,total:rows.length});
  } catch(e) { res.status(500).json({error:'Server error'}); }
});
router.post('/request', requirePartnerAuth, async (req,res) => {
  try {
    const aff=await queryOne('SELECT id,total_earned,total_paid FROM affiliates WHERE account_id=$1',[req.partnerAccount.id]);
    if(!aff) return res.status(404).json({error:'Not found'});
    const balance=parseFloat(aff.total_earned||0)-parseFloat(aff.total_paid||0);
    const {amount,method,wallet_address,chain}=req.body||{};
    if(!amount||isNaN(amount)||amount<=0) return res.status(400).json({error:'Invalid amount'});
    if(amount>balance) return res.status(400).json({error:`Insufficient balance. Available: $${balance.toFixed(2)}`});
    if(amount<10) return res.status(400).json({error:'Minimum payout is $10'});
    const id=uuidv4();
    await query('INSERT INTO affiliate_payout_requests (id,affiliate_id,account_id,amount,method,wallet_address,chain) VALUES ($1,$2,$3,$4,$5,$6,$7)',[id,aff.id,req.partnerAccount.id,amount,method||'crypto',wallet_address,chain]);
    await logAudit(req.partnerAccount.id,'payout_request',req.ip,{amount,method});
    res.json({ok:true,id,status:'pending'});
  } catch(e) { res.status(500).json({error:'Server error'}); }
});
module.exports = router;
