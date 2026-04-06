'use strict';
const express = require('express');
const crypto  = require('crypto');
const { v4: uuidv4 } = require('uuid');
const { queryOne, query } = require('../pgdb');
const { authMiddleware } = require('../middleware/auth');
const router = express.Router();

const DJ_BASE     = process.env.DIJOKER_BASE_URL    || 'https://stg-game-launcher.dijoker.com';
const DJ_API_KEY  = process.env.DIJOKER_API_KEY;
const DJ_SECRET   = process.env.DIJOKER_SECRET;
const DJ_OPERATOR = process.env.DIJOKER_OPERATOR_ID || '8664919b-68bb-47f8-aba6-852f8736e757';

function hmacB64(msg) {
  return crypto.createHmac('sha512', DJ_SECRET||'').update(msg).digest('base64');
}
function djAuth(req, res, next) {
  const k = req.headers['app-key'];
  if (!DJ_API_KEY || !k || k !== DJ_API_KEY) return res.status(401).json({error:'UNAUTHORIZED'});
  req._djHash = req.headers['hash'] || '';
  next();
}
async function getSession(sk) {
  return queryOne('SELECT * FROM dijoker_sessions WHERE session_key=$1 AND active=TRUE',[sk]);
}
async function getBal(uid) {
  const r = await queryOne('SELECT balance FROM users WHERE id=$1',[uid]);
  return parseFloat(r?.balance||0);
}
async function updateBal(uid, delta) {
  const r = await queryOne('UPDATE users SET balance=balance+$1 WHERE id=$2 RETURNING balance',[delta,uid]);
  return parseFloat(r?.balance||0);
}

router.get('/games', authMiddleware, async (req, res) => {
  try {
    const r = await fetch(DJ_BASE+'/api/v1/games/public/list');
    res.json(await r.json());
  } catch(e) { res.status(500).json({error:e.message}); }
});

router.post('/launch', authMiddleware, async (req, res) => {
  try {
    const {game_id, device} = req.body;
    if (!game_id) return res.status(400).json({error:'game_id required'});
    if (!DJ_API_KEY||!DJ_SECRET) return res.status(503).json({error:'DiJoker not configured'});
    const uid = req.user.id;
    const sk  = uuidv4();
    const cur = req.user.preferred_currency||req.user.currency||'USD';
    const ts  = Math.floor(Date.now()/1000);
    const hash = hmacB64(DJ_OPERATOR+game_id+uid+String(ts)+DJ_API_KEY);
    const payload = {
      operatorId:DJ_OPERATOR, playerId:uid, playerName:req.user.email||'player',
      gameId:game_id, device:(device||'').toUpperCase()==='MOBILE'?'mobile':'desktop',
      lang:'en', currency:cur, session:sk, quitLink:'https://cryptora.live/',
      hash, timestamp:ts, isTest:process.env.NODE_ENV!=='production'
    };
    const r = await fetch(DJ_BASE+'/api/v1/generate_url',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});
    const d = await r.json();
    if (!r.ok) return res.status(502).json({error:d.message||'DiJoker error'});
    await query('INSERT INTO dijoker_sessions (session_key,user_id,game_id,dj_token,refresh_token,currency) VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (session_key) DO UPDATE SET dj_token=$4,active=TRUE',
      [sk,uid,game_id,d?.data?.token,d?.data?.refreshToken,cur]);
    res.json({url:d?.data?.url, session:sk});
  } catch(e) { console.error('[DJ/launch]',e.message); res.status(500).json({error:'Launch failed'}); }
});

router.post('/wallet/auth', djAuth, async (req,res) => {
  try {
    const {sessionKey,gameCode} = req.body;
    if (req._djHash !== hmacB64(String(sessionKey)+String(gameCode))) return res.status(401).json({error:'HASH_MISMATCH'});
    const s = await getSession(sessionKey);
    if (!s) return res.status(401).json({error:'SESSION_NOT_FOUND'});
    const u = await queryOne('SELECT id,currency FROM users WHERE id=$1',[s.user_id]);
    if (!u) return res.status(401).json({error:'PLAYER_NOT_FOUND'});
    res.json({data:{currency:s.currency||u.currency||'USD',session:sessionKey,lang:'en',playerId:s.user_id},token:s.dj_token,refreshToken:s.refresh_token});
  } catch(e) { res.status(500).json({error:'TECHNICAL_ERROR'}); }
});

router.post('/wallet/get-balance', djAuth, async (req,res) => {
  try {
    const {sessionKey} = req.body;
    if (req._djHash !== hmacB64(String(sessionKey))) return res.status(401).json({error:'HASH_MISMATCH'});
    const s = await getSession(sessionKey);
    if (!s) return res.status(401).json({error:'SESSION_NOT_FOUND'});
    const b = await getBal(s.user_id);
    res.json({data:{playerBalance:parseFloat(b.toFixed(2))}});
  } catch(e) { res.status(500).json({error:'TECHNICAL_ERROR'}); }
});

router.post('/wallet/update-balance', djAuth, async (req,res) => {
  try {
    const {sessionKey,freeSpin,bet,win,jackpotWin,roundId,transactionId,transactionType,isRoundEnd} = req.body;
    const fs = freeSpin||{win:0,played:0,remained:0};
    const msg = String(sessionKey)+String(fs.win)+String(fs.played)+String(fs.remained)+String(bet)+String(win)+String(jackpotWin||0)+String(roundId)+String(transactionId)+String(isRoundEnd);
    if (req._djHash !== hmacB64(msg)) return res.status(401).json({error:'HASH_MISMATCH'});
    const s = await getSession(sessionKey);
    if (!s) return res.status(401).json({error:'SESSION_NOT_FOUND'});
    const ex = await queryOne('SELECT id,balance_after FROM dijoker_transactions WHERE transaction_id=$1 AND rolled_back=FALSE',[transactionId]);
    if (ex) return res.json({data:{transactionId:ex.id,playerBalance:parseFloat(ex.balance_after)}});
    const betAmt = parseFloat(bet)||0;
    const winAmt = (parseFloat(win)||0)+(parseFloat(jackpotWin)||0);
    if (betAmt>0 && await getBal(s.user_id)<betAmt) return res.status(400).json({error:'INSUFFICIENT_FUNDS'});
    const delta = winAmt-betAmt;
    const newBal = await updateBal(s.user_id,delta);
    const txId = uuidv4();
    await query('INSERT INTO dijoker_transactions (id,transaction_id,session_key,user_id,round_id,bet_amount,win_amount,net_amount,transaction_type,is_round_end,balance_after,rolled_back) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,FALSE)',
      [txId,transactionId,sessionKey,s.user_id,roundId,betAmt,winAmt,delta,transactionType||'bet',!!isRoundEnd,newBal]);
    if (betAmt>0) query('UPDATE jackpot SET amount=LEAST(amount+$1*contribution_rate,max_amount) WHERE id=(SELECT id FROM jackpot LIMIT 1)',[betAmt]).catch(()=>{});
    res.json({data:{transactionId:txId,playerBalance:parseFloat(newBal.toFixed(2))}});
  } catch(e) { console.error('[DJ/update]',e.message); res.status(500).json({error:'TECHNICAL_ERROR'}); }
});

router.post('/wallet/refund-bet', djAuth, async (req,res) => {
  try {
    const {sessionKey,transactionId} = req.body;
    if (req._djHash !== hmacB64(String(sessionKey)+String(transactionId))) return res.status(401).json({error:'HASH_MISMATCH'});
    const s = await getSession(sessionKey);
    if (!s) return res.status(401).json({error:'SESSION_NOT_FOUND'});
    const tx = await queryOne('SELECT * FROM dijoker_transactions WHERE transaction_id=$1 AND user_id=$2',[transactionId,s.user_id]);
    if (!tx) return res.status(404).json({error:'TRANSACTION_NOT_FOUND'});
    if (tx.rolled_back) return res.status(400).json({error:'ALREADY_REFUNDED'});
    const nb = await updateBal(s.user_id,-parseFloat(tx.net_amount));
    await query('UPDATE dijoker_transactions SET rolled_back=TRUE WHERE transaction_id=$1',[transactionId]);
    res.json({data:{playerBalance:parseFloat(nb.toFixed(2))}});
  } catch(e) { res.status(500).json({error:'TECHNICAL_ERROR'}); }
});

module.exports = router;
