// netlify/functions/adminLogin.js
const { getConfig } = require('./db');
const crypto = require('crypto');

function getSecret() {
  return process.env.ADMIN_SECRET || 'paperpure_hmac_secret_2024';
}

function generateToken(user) {
  const ts = Date.now().toString();
  const nonce = crypto.randomBytes(8).toString('hex');
  const hmac = crypto.createHmac('sha256', getSecret()).update(`${user}:${ts}:${nonce}`).digest('hex');
  return Buffer.from(JSON.stringify({ user, ts, nonce, hmac })).toString('base64url');
}

function verifyAdminToken(token) {
  if (!token) return false;
  if (process.env.ADMIN_STATIC_TOKEN && token === process.env.ADMIN_STATIC_TOKEN) return true;
  try {
    const { user, ts, nonce, hmac } = JSON.parse(Buffer.from(token, 'base64url').toString('utf8'));
    if (!user || !ts || !hmac) return false;
    if (Date.now() - parseInt(ts) > 24 * 60 * 60 * 1000) return false;
    const expected = crypto.createHmac('sha256', getSecret()).update(`${user}:${ts}:${nonce || ''}`).digest('hex');
    return crypto.timingSafeEqual(Buffer.from(hmac, 'hex'), Buffer.from(expected, 'hex'));
  } catch { return false; }
}

exports.handler = async (event) => {
  const h = { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST,OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' };
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: h, body: '' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers: h, body: '{}' };

  let body;
  try { body = JSON.parse(event.body); } catch { return { statusCode: 400, headers: h, body: JSON.stringify({ success: false }) }; }

  const { username, password } = body;
  const config = await getConfig();
  const adminUser = process.env.ADMIN_USER || config.adminUser || 'admin';
  const adminPass = process.env.ADMIN_PASS || config.adminPassword || 'admin123';

  if (username === adminUser && password === adminPass) {
    return { statusCode: 200, headers: h, body: JSON.stringify({ success: true, token: generateToken(username) }) };
  }
  await new Promise(r => setTimeout(r, 300));
  return { statusCode: 200, headers: h, body: JSON.stringify({ success: false, message: '用户名或密码错误' }) };
};

exports.verifyAdminToken = verifyAdminToken;
