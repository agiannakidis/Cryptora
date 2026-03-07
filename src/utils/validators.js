/**
 * Shared validators — used across all route handlers
 */

function validateAmount(val, opts) {
  var o = opts || {};
  var min = o.min !== undefined ? o.min : 0.000001;
  var max = o.max !== undefined ? o.max : 10000000;
  var num = parseFloat(val);
  if (val === undefined || val === null || val === '') return { valid: false, error: 'Amount is required' };
  if (isNaN(num) || !isFinite(num)) return { valid: false, error: 'Amount must be a number' };
  if (num <= 0) return { valid: false, error: 'Amount must be positive' };
  if (num < min) return { valid: false, error: 'Amount must be at least ' + min };
  if (num > max) return { valid: false, error: 'Amount too large (max ' + max + ')' };
  return { valid: true, value: num };
}

function sanitizeString(val, maxLen) {
  if (typeof val !== 'string') return '';
  return val.replace(/[\x00-\x1f\x7f]/g, '').slice(0, maxLen || 500).trim();
}

module.exports = { validateAmount, sanitizeString };
