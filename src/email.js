// /root/casino-backend/src/email.js
const nodemailer = require('nodemailer');

const SITE_URL = process.env.SITE_URL || 'https://cryptora.live';
const FROM     = process.env.SMTP_FROM  || 'Cryptora <noreply@cryptora.live>';

// Build transporter — falls back to console log if SMTP not configured
function getTransporter() {
  if (process.env.SMTP_HOST) {
    return nodemailer.createTransport({
      host:   process.env.SMTP_HOST,
      port:   parseInt(process.env.SMTP_PORT || '587'),
      secure: process.env.SMTP_SECURE === 'true',
      auth:   { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
      requireTLS: !( process.env.SMTP_SECURE === 'true'),
    });
  }
  // No SMTP — use ethereal (test account) or just log
  return null;
}

async function sendVerificationEmail(toEmail, token) {
  const link = `${SITE_URL}/verify-email?token=${token}`;

  const html = `
    <!DOCTYPE html>
    <html>
    <body style="background:#0a0e1a;color:#ffffff;font-family:Arial,sans-serif;padding:40px;margin:0">
      <div style="max-width:520px;margin:0 auto;background:#141829;border-radius:16px;padding:40px;border:1px solid #252b45">
        <div style="text-align:center;margin-bottom:32px">
          <div style="width:56px;height:56px;background:linear-gradient(135deg,#FFE566,#FFBB00,#E05500);border-radius:14px;margin:0 auto 16px;display:flex;align-items:center;justify-content:center;font-size:28px">◆</div>
          <h1 style="color:#FFBB00;font-size:24px;margin:0">Cryptora</h1>
          <p style="color:#64748b;font-size:13px;margin:4px 0 0">Crypto Casino</p>
        </div>

        <h2 style="color:#ffffff;font-size:20px;margin:0 0 12px">Confirm your email</h2>
        <p style="color:#94a3b8;font-size:15px;line-height:1.6;margin:0 0 28px">
          Welcome to Cryptora! Click the button below to verify your email address and activate your account.
        </p>

        <a href="${link}"
           style="display:block;background:linear-gradient(135deg,#FFE566,#FFBB00);color:#0a0e1a;text-decoration:none;padding:16px 32px;border-radius:12px;font-weight:700;font-size:16px;text-align:center;margin-bottom:24px">
          ✅ Verify Email Address
        </a>

        <p style="color:#475569;font-size:13px;margin:0 0 8px">Or paste this link in your browser:</p>
        <p style="color:#FFBB00;font-size:12px;word-break:break-all;background:#0a0e1a;padding:12px;border-radius:8px;margin:0 0 24px">${link}</p>

        <p style="color:#475569;font-size:12px;margin:0">This link expires in <strong style="color:#94a3b8">24 hours</strong>. If you didn't register, ignore this email.</p>
      </div>
    </body>
    </html>
  `;

  const transporter = getTransporter();

  if (!transporter) {
    // No SMTP — log to console for development
    console.log('\n========================================');
    console.log('[EMAIL] Verification link for:', toEmail);
    console.log('[EMAIL] Link:', link);
    console.log('========================================\n');
    return { ok: true, method: 'console' };
  }

  try {
    await transporter.sendMail({
      from: FROM,
      to: toEmail,
      subject: '✅ Verify your Cryptora account',
      html,
      text: `Verify your Cryptora account: ${link}`,
    });
    return { ok: true, method: 'smtp' };
  } catch (err) {
    console.error('[EMAIL] Send failed:', err.message);
    console.log('[EMAIL] Fallback link for', toEmail, ':', link);
    return { ok: false, error: err.message };
  }
}

async function sendPasswordResetEmail(toEmail, token) {
  const link = `${SITE_URL}/reset-password?token=${token}`;
  const transporter = getTransporter();
  if (!transporter) {
    console.log('\n[EMAIL] Password reset for:', toEmail, '\n[EMAIL] Link:', link);
    return { ok: true, method: 'console' };
  }
  try {
    await transporter.sendMail({
      from: FROM,
      to: toEmail,
      subject: '🔑 Reset your Cryptora password',
      html: `<p>Reset link: <a href="${link}">${link}</a></p>`,
      text: `Reset your password: ${link}`,
    });
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}


async function sendVerificationCode(toEmail, code) {
  const html = `
    <!DOCTYPE html>
    <html>
    <body style="background:#0a0e1a;color:#ffffff;font-family:Arial,sans-serif;padding:40px;margin:0">
      <div style="max-width:480px;margin:0 auto;background:#141829;border-radius:16px;padding:40px;border:1px solid #252b45">
        <div style="text-align:center;margin-bottom:32px">
          <div style="width:56px;height:56px;background:linear-gradient(135deg,#FFE566,#FFBB00,#E05500);border-radius:14px;margin:0 auto 16px;display:flex;align-items:center;justify-content:center;font-size:28px">◆</div>
          <h1 style="color:#FFBB00;font-size:24px;margin:0">Cryptora</h1>
        </div>
        <h2 style="color:#ffffff;font-size:20px;margin:0 0 12px;text-align:center">Email Verification</h2>
        <p style="color:#94a3b8;font-size:15px;line-height:1.6;margin:0 0 28px;text-align:center">
          Enter this code to verify your account:
        </p>
        <div style="background:#0a0e1a;border:2px solid #FFBB00;border-radius:16px;padding:24px;text-align:center;margin-bottom:24px">
          <span style="font-size:42px;font-weight:900;letter-spacing:16px;color:#FFBB00;font-family:monospace">${code}</span>
        </div>
        <p style="color:#475569;font-size:13px;margin:0;text-align:center">Code expires in <strong style="color:#94a3b8">24 hours</strong>. If you didn't register, ignore this email.</p>
      </div>
    </body>
    </html>
  `;

  const transporter = getTransporter();
  if (!transporter) {
    console.log('\n========================================');
    console.log('[EMAIL] Verification code for:', toEmail);
    console.log('[EMAIL] Code:', code);
    console.log('========================================\n');
    return { ok: true, method: 'console' };
  }
  try {
    await transporter.sendMail({
      from: FROM,
      to: toEmail,
      subject: `${code} — Your Cryptora verification code`,
      html,
      text: `Your Cryptora verification code: ${code}. Expires in 24 hours.`,
    });
    return { ok: true, method: 'smtp' };
  } catch (err) {
    console.error('[EMAIL] Send failed:', err.message);
    console.log('[EMAIL] Fallback code for', toEmail, ':', code);
    return { ok: false, error: err.message };
  }
}

module.exports = { sendVerificationEmail, sendVerificationCode, sendPasswordResetEmail };
