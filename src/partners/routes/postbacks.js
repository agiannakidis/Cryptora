'use strict';
const express = require('express');
const { queryOne, queryAll, query } = require('../../pgdb');
const { requirePartnerAuth, logAudit } = require('../middleware');
const router = express.Router();
router.get('/', requirePartnerAuth, async (req,res) => {
  try {
    const aff=await queryOne('SELECT id,postback_url FROM affiliates WHERE account_id=$1',[req.partnerAccount.id]);
    if(!aff) return res.json({postback_url:null,deliveries:[]});
    const dels=await queryAll('SELECT id,event_type,response_code,success,error_message,created_at FROM affiliate_postback_deliveries WHERE affiliate_id=$1 ORDER BY created_at DESC LIMIT 20',[aff.id]);
    res.json({postback_url:aff.postback_url,deliveries:dels});
  } catch(e) { res.status(500).json({error:'Server error'}); }
});
router.put('/', requirePartnerAuth, async (req,res) => {
  const {postback_url}=req.body||{};
  if(postback_url){try{new URL(postback_url);}catch{return res.status(400).json({error:'Invalid URL'});}}
  try {
    const aff=await queryOne('SELECT id FROM affiliates WHERE account_id=$1',[req.partnerAccount.id]);
    if(!aff) return res.status(404).json({error:'Not found'});
    await query('UPDATE affiliates SET postback_url=$1 WHERE id=$2',[postback_url||null,aff.id]);
    await logAudit(req.partnerAccount.id,'postback_updated',req.ip,{url:postback_url});
    res.json({ok:true});
  } catch(e) { res.status(500).json({error:'Server error'}); }
});
router.post('/test', requirePartnerAuth, async (req,res) => {
  try {
    const aff=await queryOne('SELECT id,postback_url FROM affiliates WHERE account_id=$1',[req.partnerAccount.id]);
    if(!aff||!aff.postback_url) return res.status(400).json({error:'No postback URL set'});
    const url=aff.postback_url.replace('{event}','test').replace('{click_id}','TEST').replace('{player_id}','TEST').replace('{amount}','0');
    let code=0,ok=false,err=null;
    try{const r=await fetch(url,{method:'GET',signal:AbortSignal.timeout(5000)});code=r.status;ok=r.ok;}catch(fe){err=fe.message;}
    await query('INSERT INTO affiliate_postback_deliveries (affiliate_id,event_type,url,response_code,success,error_message) VALUES ($1,$2,$3,$4,$5,$6)',[aff.id,'test',url,code,ok,err]);
    res.json({ok:true,response_code:code,success:ok,error:err});
  } catch(e) { res.status(500).json({error:'Server error'}); }
});
module.exports = router;
