'use strict';
const express = require('express');
const { queryOne, queryAll } = require('../../pgdb');
const { requirePartnerAuth } = require('../middleware');
const router = express.Router();
router.get('/', requirePartnerAuth, async (req,res) => {
  try {
    const aff=await queryOne('SELECT id FROM affiliates WHERE account_id=$1',[req.partnerAccount.id]);
    if(!aff) return res.json({notifications:[],total:0});
    const limit=Math.min(parseInt(req.query.limit)||20,100);
    const notifs=[];
    const comms=await queryAll('SELECT id,amount,status,period_start,period_end,created_at FROM affiliate_commissions WHERE affiliate_id=$1 ORDER BY created_at DESC LIMIT 5',[aff.id]);
    for(const c of comms) notifs.push({id:'comm_'+c.id,type:'commission_'+c.status,title:'Commission '+c.status,message:'$'+parseFloat(c.amount||0).toFixed(2)+' for '+(c.period_start||'')+'–'+(c.period_end||''),created_at:c.created_at,read:false});
    const ftds=await queryAll('SELECT referred_user_id,first_deposit_date,first_deposit_amount FROM affiliate_referrals WHERE affiliate_id=$1 AND first_deposit_date IS NOT NULL ORDER BY first_deposit_date DESC NULLS LAST LIMIT 3',[aff.id]);
    for(const r of ftds) notifs.push({id:'ftd_'+r.referred_user_id,type:'new_ftd',title:'New First Deposit',message:'$'+parseFloat(r.first_deposit_amount||0).toFixed(2)+' first deposit',created_at:r.first_deposit_date,read:false});
    notifs.sort((a,b)=>new Date(b.created_at)-new Date(a.created_at));
    res.json({notifications:notifs.slice(0,limit),total:notifs.length});
  } catch(e) { res.status(500).json({error:'Server error'}); }
});
module.exports = router;
