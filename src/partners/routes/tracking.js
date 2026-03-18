'use strict';
const express = require('express');
const { queryOne, queryAll, query } = require('../../pgdb');
const { requirePartnerAuth } = require('../middleware');
const { v4:uuidv4 } = require('uuid');
const router = express.Router();
router.get('/', requirePartnerAuth, async (req,res) => {
  try {
    const aff=await queryOne('SELECT id,ref_code FROM affiliates WHERE account_id=$1',[req.partnerAccount.id]);
    if(!aff) return res.json({links:[],ref_code:''});
    const links=await queryAll('SELECT * FROM affiliate_tracking_links WHERE account_id=$1 ORDER BY created_at DESC',[req.partnerAccount.id]);
    res.json({links, ref_code:aff.ref_code, base_url:'https://cryptora.live/?ref='+aff.ref_code});
  } catch(e) { res.status(500).json({error:'Server error'}); }
});
router.post('/', requirePartnerAuth, async (req,res) => {
  try {
    const aff=await queryOne('SELECT id,ref_code FROM affiliates WHERE account_id=$1',[req.partnerAccount.id]);
    if(!aff) return res.status(404).json({error:'Not found'});
    const {name,sub1,sub2,landing_url}=req.body||{};
    if(!name) return res.status(400).json({error:'Name required'});
    const id=uuidv4();
    await query('INSERT INTO affiliate_tracking_links (id,affiliate_id,account_id,name,sub1,sub2,landing_url) VALUES ($1,$2,$3,$4,$5,$6,$7)',[id,aff.id,req.partnerAccount.id,name,sub1||null,sub2||null,landing_url||'https://cryptora.live/']);
    res.json({ok:true,id});
  } catch(e) { res.status(500).json({error:'Server error'}); }
});
router.delete('/:id', requirePartnerAuth, async (req,res) => {
  try { await query('DELETE FROM affiliate_tracking_links WHERE id=$1 AND account_id=$2',[req.params.id,req.partnerAccount.id]); res.json({ok:true}); }
  catch(e) { res.status(500).json({error:'Server error'}); }
});
module.exports = router;
