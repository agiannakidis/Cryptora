/**
 * GEO-blocking middleware for Cryptora
 * Uses ip-api.com (free, up to 45 req/min)
 * Blocked countries: US, UK, AU, FR, DE, NL, IT, ES (regulated markets)
 */
const https = require('https');
const http = require('http');

// Countries to BLOCK (add/remove as needed)
const BLOCKED_COUNTRIES = new Set([
  'US', // United States
  'GB', // United Kingdom
  'AU', // Australia
  'FR', // France
  'DE', // Germany
  'NL', // Netherlands
  'IT', // Italy
  'ES', // Spain
  'BE', // Belgium
  'PL', // Poland
  'HU', // Hungary
  'RO', // Romania (strict online gambling laws)
  'CZ', // Czech Republic
]);

// Cache IP lookups for 1 hour to avoid rate limits
const ipCache = new Map();
const CACHE_TTL = 60 * 60 * 1000; // 1 hour

function getIpCountry(ip) {
  const cached = ipCache.get(ip);
  if (cached && Date.now() - cached.ts < CACHE_TTL) {
    return Promise.resolve(cached.country);
  }

  // Skip private/loopback IPs
  if (ip === '127.0.0.1' || ip === '::1' || ip.startsWith('192.168.') || ip.startsWith('10.') || ip.startsWith('172.')) {
    return Promise.resolve('XX'); // local = allowed
  }

  return new Promise((resolve) => {
    const req = http.get(`http://ip-api.com/json/${ip}?fields=countryCode,status`, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          const country = json.status === 'success' ? json.countryCode : 'XX';
          ipCache.set(ip, { country, ts: Date.now() });
          resolve(country);
        } catch {
          resolve('XX');
        }
      });
    });
    req.on('error', () => resolve('XX'));
    req.setTimeout(3000, () => { req.destroy(); resolve('XX'); });
  });
}

function getClientIp(req) {
  // Trust X-Forwarded-For header from nginx proxy
  const forwarded = req.headers['x-forwarded-for'];
  if (forwarded) {
    return forwarded.split(',')[0].trim();
  }
  return req.connection?.remoteAddress || req.socket?.remoteAddress || '127.0.0.1';
}

// Middleware factory
function geoBlock(options = {}) {
  const blocked = options.countries ? new Set(options.countries) : BLOCKED_COUNTRIES;
  const bypassPaths = options.bypassPaths || ['/api/auth/login', '/api/auth/register', '/health'];

  return async function geoBlockMiddleware(req, res, next) {
    // Bypass for health checks and admin
    const path = req.path || req.url || '';
    if (bypassPaths.some(p => path.startsWith(p))) return next();
    if (path.startsWith('/api/admin') || path.startsWith('/admin')) return next();

    const ip = getClientIp(req);

    try {
      const country = await getIpCountry(ip);
      req.country = country; // attach to request for logging

      if (blocked.has(country)) {
        console.log(`[geo-block] Blocked: ${ip} (${country}) → ${path}`);
        return res.status(403).json({
          error: 'This service is not available in your region.',
          code: 'GEO_BLOCKED',
          country: country,
        });
      }
    } catch (e) {
      // On error, allow through (fail open)
      console.warn('[geo-block] lookup error:', e.message);
    }

    next();
  };
}

module.exports = geoBlock;
module.exports.BLOCKED_COUNTRIES = BLOCKED_COUNTRIES;
module.exports.getIpCountry = getIpCountry;
