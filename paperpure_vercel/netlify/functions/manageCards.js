// netlify/functions/manageCards.js
const { getCards, getCard, saveCard, updateCard, deleteCard, addCards, setConfig } = require('./db');
const { verifyAdminToken } = require('./adminLogin');

function generateKey(prefix = '') {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let key = prefix.toUpperCase();
  const target = Math.max(8, prefix.length + 6);
  while (key.length < target) key += chars[Math.floor(Math.random() * chars.length)];
  return key;
}

exports.handler = async (event) => {
  const h = { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST,GET,OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type,x-admin-token' };
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: h, body: '' };

  const token = event.headers['x-admin-token'];
  if (!verifyAdminToken(token)) return { statusCode: 401, headers: h, body: JSON.stringify({ success: false, message: '未授权' }) };

  let body;
  try { body = JSON.parse(event.body || '{}'); } catch { return { statusCode: 400, headers: h, body: JSON.stringify({ success: false, message: '格式错误' }) }; }

  const ok  = (data = {}) => ({ statusCode: 200, headers: h, body: JSON.stringify({ success: true, ...data }) });
  const err = (msg)       => ({ statusCode: 200, headers: h, body: JSON.stringify({ success: false, message: msg }) });

  const { action } = body;

  if (action === 'list') {
    const cards = await getCards();
    return ok({ cards });
  }

  if (action === 'add') {
    const key = (body.card_key || generateKey()).toUpperCase();
    if (await getCard(key)) return err('卡密已存在');
    await saveCard({ card_key: key, remaining_times: body.remaining_times || 10, status: 'active', created_at: new Date().toISOString() });
    return ok({ key });
  }

  if (action === 'update') {
    const updates = {};
    if (body.remaining_times !== undefined) updates.remaining_times = body.remaining_times;
    if (body.status !== undefined)          updates.status = body.status;
    await updateCard(body.card_key, updates);
    return ok();
  }

  if (action === 'delete') {
    await deleteCard(body.card_key);
    return ok();
  }

  if (action === 'batch') {
    const count  = Math.min(body.count || 10, 500);
    const times  = body.times || 10;
    const prefix = (body.prefix || '').toUpperCase();
    const existing = new Set((await getCards()).map(c => c.card_key));
    const keys = [];
    for (let i = 0; i < count; i++) {
      let key, att = 0;
      do { key = generateKey(prefix); att++; } while (existing.has(key) && att < 20);
      existing.add(key); keys.push(key);
    }
    await addCards(keys.map(k => ({ card_key: k, remaining_times: times, status: 'active', created_at: new Date().toISOString() })));
    return ok({ keys });
  }

  // 配置项保存
  if (action === 'saveApiKey') {
    const key = (body.kimiApiKey || '').trim();
    if (!key) return err('API Key 不能为空');
    await setConfig('kimi_api_key', key);
    return ok();
  }

  if (action === 'changePassword') {
    if (!body.password || body.password.length < 6) return err('密码至少6位');
    await setConfig('admin_password', body.password);
    return ok();
  }

  if (action === 'saveConfig') {
    const cfg = body.config || {};
    if (cfg.freeEnabled !== undefined) await setConfig('free_enabled', String(cfg.freeEnabled));
    if (cfg.freeLimit   !== undefined) await setConfig('free_limit', String(cfg.freeLimit));
    if (cfg.notice      !== undefined) await setConfig('notice', cfg.notice);
    return ok();
  }

  if (action === 'saveNotice') {
    await setConfig('notice', body.notice || '');
    return ok();
  }

  return err('未知操作');
};
