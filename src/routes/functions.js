const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { query, queryOne } = require('../pgdb');
const { authMiddleware } = require('../middleware/auth');

const router = express.Router();
const crypto = require('crypto');

function md5(message) {
  return crypto.createHash('md5').update(message).digest('hex').toUpperCase();
}

// ─── Helper: save game session to PG ────────────────────────────────────────
async function saveSession(userId, userEmail, gameName, gameTitle, provider, sessionId, launchUrl) {
  await query(
    `INSERT INTO game_sessions
       (id, user_id, user_email, game_id, game_title, provider, session_token, status, created_date, launch_url)
     VALUES ($1,$2,$3,$4,$5,$6,$7,'active',NOW(),$8)
     ON CONFLICT DO NOTHING`,
    [uuidv4(), userId, userEmail, gameName, gameTitle || gameName, provider, sessionId, launchUrl || '']
  );
}

// ─── POST /api/functions/launchGame ─────────────────────────────────────────
function isMobileUA(req) {
  const ua = (req.headers['user-agent'] || '').toLowerCase();
  return /mobile|android|iphone|ipad|ipod|blackberry|windows phone/.test(ua);
}

router.post('/launchGame', authMiddleware, async (req, res) => {
  try {
    const { gameId, demo = false } = req.body;
    const privateKey  = process.env.PRAGMATIC_PRIVATE_KEY;
    const operatorId  = process.env.PRAGMATIC_OPERATOR_ID || '749843';
    const callbackUrl = process.env.CALLBACK_URL || 'http://89.167.108.79/api/functions/walletApi';

    // Look up game + provider from PG
    const game = await queryOne(
      'SELECT * FROM games WHERE game_id = $1 OR id = $1 LIMIT 1', [gameId]
    );
    const providerName = game?.provider || 'Pragmatic Play';
    const providerRow  = await queryOne(
      'SELECT * FROM game_providers WHERE name = $1', [providerName]
    );

    const userId   = req.user.id;
    const username = req.user.email;
    const currency = req.user.currency || 'USD';
    const sessionId = uuidv4();
    const gameName  = game?.game_id || gameId;
    const mode      = demo ? 'demo' : 'external';

    const closeUrl = isMobileUA(req) ? 'https://cryptora.live/' : '';
    let launchUrl = null;
    let fullUrl = '';
    let responseStatus = 0;
    let responseBody = '';
    let signatureInput = '';
    let accessPassword = '';

    // ── Yggdrasil ──────────────────────────────────────────────────────────
    if (providerName === 'Yggdrasil') {
      const launcherBase = providerRow?.api_base_url || 'https://gs2.grandx.pro/yggdrasil-admin/launcher.html';
      const params = new URLSearchParams({
        gameName, operatorId, sessionId,
        userName: username, mode, currency,
        device: 'desktop', closeUrl,
      });
      launchUrl = `${launcherBase}?${params.toString()}`;
      fullUrl = launchUrl;
      responseStatus = 200;
      responseBody = 'Yggdrasil URL constructed directly';

    // ── NetGame / Novomatic ───────────────────────────────────────────────
    } else if (['NetGame', 'Novomatic'].includes(providerName)) {
      const launcherMap = {
        Novomatic: 'https://gs2.grandx.pro/novomatic-admin/launcher.html',
        NetGame:   'https://gs2.grandx.pro/netgame-admin/launcher.html',
      };
      const launcherBase = providerRow?.api_base_url || launcherMap[providerName];
      const params = new URLSearchParams({
        gameName, operatorId, sessionId,
        userName: username, mode, currency: 'USD',
        closeUrl,
      });
      launchUrl = `${launcherBase}?${params.toString()}`;
      fullUrl = launchUrl;
      responseStatus = 200;
      responseBody = providerName + ' URL constructed directly';

    // ── Amatic ────────────────────────────────────────────────────────────
    } else if (providerName === 'Amatic') {
      const launcherBase = providerRow?.api_base_url || 'https://gs2.grandx.pro/amatic-admin/launcher/opengame.html';
      const amaticOpId = operatorId;
      const params = new URLSearchParams({
        gameName, operatorId: amaticOpId, sessionId,
        playerName: username, mode, currency: 'EUR',
        closeUrl,
      });
      launchUrl = `${launcherBase}?${params.toString()}`;
      fullUrl = launchUrl;
      responseStatus = 200;
      responseBody = 'Amatic URL constructed directly';

    // ── Crash Games (Zeppelin etc via solutions-admin) ─────────────────
    } else if (providerName === 'Crash Games') {
      const crashBase = providerRow?.api_base_url || 'https://gs2.grandx.pro/solutions-admin/launcher.html';
      const params = new URLSearchParams({
        gameName, operatorId, sessionId,
        userName: username, mode, closeUrl,
      });
      launchUrl = `${crashBase}?${params.toString()}`;
      fullUrl = launchUrl;
      responseStatus = 200;
      responseBody = 'Crash game URL constructed';

    // ── Play'n GO (numeric gameId via GrandX) ───────────────────────────
    } else if (providerName === "Play'n GO") {
      const pngUrl = process.env.PRAGMATIC_API_URL ||
        'https://gs2.grandx.pro/euro-extern/dispatcher/egame/openGame/v2';
      const pngGameId = game?.provider_game_id || gameName;
      signatureInput = `${privateKey}operatorId=${operatorId}&username=${username}&sessionId=${sessionId}&gameId=${pngGameId}`;
      accessPassword = md5(signatureInput);
      const params = new URLSearchParams({ accessPassword, operatorId, username, sessionId, gameId: pngGameId });
      fullUrl = `${pngUrl}?${params.toString()}`;

      try {
        const response = await fetch(fullUrl, { method: 'POST' });
        responseStatus = response.status;
        const text = await response.text();
        responseBody = text;
        const trimmed = text.trim();
        if (trimmed.startsWith('http')) {
          launchUrl = trimmed;
        } else {
          try {
            const json = JSON.parse(trimmed);
            launchUrl = json?.gameURL || json?.url || json?.game?.url || json?.gameUrl || json?.launch_url || null;
          } catch {}
        }
      } catch (fetchErr) {
        responseBody = fetchErr.message;
      }

    // ── Pragmatic Play ─────────────────────────────────────────────────────
    } else {
      const pragmaticUrl = process.env.PRAGMATIC_API_URL ||
        'https://gs2.grandx.pro/euro-extern/dispatcher/egame/openGame/v2';
      signatureInput = `${privateKey}operatorId=${operatorId}&username=${username}&sessionId=${sessionId}&gameId=${gameName}`;
      accessPassword = md5(signatureInput);
      const params = new URLSearchParams({ accessPassword, operatorId, username, sessionId, gameId: gameName });
      fullUrl = `${pragmaticUrl}?${params.toString()}`;

      try {
        const response = await fetch(fullUrl, { method: 'POST' });
        responseStatus = response.status;
        const text = await response.text();
        responseBody = text;
        const trimmed = text.trim();
        if (trimmed.startsWith('http')) {
          launchUrl = trimmed;
        } else {
          try {
            const json = JSON.parse(trimmed);
            launchUrl = json?.gameURL || json?.url || json?.game?.url || json?.gameUrl || json?.launch_url || null;
          } catch {}
        }
      } catch (fetchErr) {
        responseBody = fetchErr.message;
      }
    }

    await saveSession(userId, username, gameName, game?.title, providerName, sessionId, launchUrl);

    res.json({
      launchUrl, sessionId,
      debug: {
        requestUrl: fullUrl, provider: providerName,
        signatureInput, accessPassword,
        responseStatus, responseBody,
      }
    });
  } catch (err) {
    console.error('launchGame error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─── POST /api/functions/launchNetGame ───────────────────────────────────────
router.post('/launchNetGame', authMiddleware, async (req, res) => {
  try {
    const { gameName, demo = false } = req.body;
    const operatorId = process.env.PRAGMATIC_OPERATOR_ID || '749843';
    const sessionId  = uuidv4();
    const userName   = req.user.email;
    const mode       = demo ? 'demo' : 'external';

    const params = new URLSearchParams({
      gameName, operatorId, sessionId,
      userName, mode, closeUrl: isMobileUA(req) ? 'https://cryptora.live/' : '',
    });
    const launchUrl = `https://gs2.grandx.pro/netgame-admin/launcher.html?${params.toString()}`;

    await saveSession(req.user.id, userName, gameName, gameName, 'NetGame', sessionId, launchUrl);

    res.json({ launchUrl, sessionId });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── POST /api/functions/getNetGameUrl ──────────────────────────────────────
router.post('/getNetGameUrl', authMiddleware, async (req, res) => {
  try {
    const { gameName, sessionId: existingSession, demo = false } = req.body;
    const operatorId = process.env.PRAGMATIC_OPERATOR_ID || '749843';
    const sessionId  = existingSession || uuidv4();
    const mode       = demo ? 'demo' : 'external';

    const params = new URLSearchParams({
      gameName, operatorId, sessionId,
      userName: req.user.email, mode, closeUrl: isMobileUA(req) ? 'https://cryptora.live/' : '',
    });
    const launchUrl = `https://gs2.grandx.pro/netgame-admin/launcher.html?${params.toString()}`;
    res.json({ launchUrl, sessionId });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── POST /api/functions/createCryptoCheckout (Stripe) ──────────────────────
router.post('/createCryptoCheckout', authMiddleware, async (req, res) => {
  try {
    const { email, amount, crypto: cryptoType } = req.body;
    const stripeKey = process.env.STRIPE_SECRET_KEY;
    if (!stripeKey) return res.status(500).json({ error: 'Stripe not configured' });

    const Stripe = require('stripe');
    const stripe = new Stripe(stripeKey);
    const origin = req.headers.origin || `http://${req.headers.host}`;

    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      line_items: [{
        price_data: {
          currency: 'usd',
          product_data: { name: `Crypto Deposit - ${(cryptoType || '').toUpperCase()}` },
          unit_amount: Math.round(amount * 100),
        },
        quantity: 1,
      }],
      mode: 'payment',
      customer_email: email,
      success_url: `${origin}/Wallet?deposit=success&type=crypto`,
      cancel_url:  `${origin}/Wallet?deposit=cancelled`,
    });

    res.json({ checkoutUrl: session.url, sessionId: session.id });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
