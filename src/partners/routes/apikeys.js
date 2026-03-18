'use strict';
const express = require('express');
const crypto = require('crypto');
const { queryOne, queryAll, query } = require('../../pgdb');
const { requirePartnerAuth, logAudit } = require('../middleware');
const { v4:uuidv4 } = require('uuid');
const router = express.Router();
router.get('/', requirePartnerAuth, async (req,res) => {
  try {
    const rows=await queryAll('SELECT id,name,key_prefix,last_used_at,last_used_ip,revoked_at,created_at FROM affiliate_api_keys WHERE account_id=$1 ORDER BY created_at DESC',[req.partnerAccount.id]);
    res.json({keys:rows});
  } catch(e) { res.status(500).json({error:'Server error'}); }
});
router.post('/', requirePartnerAuth, async (req,res) => {
  try {
    const raw='ck_'+crypto.randomBytes(24).toString('hex');
    const hash=crypto.createHash('sha256').update(raw).digest('hex');
    const prefix=raw.slice(0,12);
    const id=uuidv4();
    await query('INSERT INTO affiliate_api_keys (id,account_id,name,key_hash,key_prefix) VALUES ($1,$2,$3,$4,$5)',[id,req.partnerAccount.id,req.body?.name||'API Key',hash,prefix]);
    await logAudit(req.partnerAccount.id,'api_key_created',req.ip,{prefix});
    res.json({ok:true,id,key:raw,key_prefix:prefix,warning:'Save this key now — it will not be shown again.'});
  } catch(e) { res.status(500).json({error:'Server error'}); }
});
router.post('/:id/revoke', requirePartnerAuth, async (req,res) => {
  try {
    await query('UPDATE affiliate_api_keys SET revoked_at=NOW() WHERE id=$1 AND account_id=$2',[req.params.id,req.partnerAccount.id]);
    await logAudit(req.partnerAccount.id,'api_key_revoked',req.ip,{key_id:req.params.id});
    res.json({ok:true});
  } catch(e) { res.status(500).json({error:'Server error'}); }
});
module.exports = router;
