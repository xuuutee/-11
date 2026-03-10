// netlify/functions/verifyCard.js
const { getCard } = require('./db');

exports.handler = async (event) => {
  const h = { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Allow-Methods': 'POST,OPTIONS' };
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: h, body: '' };

  let body;
  try { body = JSON.parse(event.body); } catch { return { statusCode: 400, headers: h, body: JSON.stringify({ success: false }) }; }

  const key = (body.key || '').trim().toUpperCase();
  if (!key) return { statusCode: 200, headers: h, body: JSON.stringify({ success: false, message: '请输入卡密' }) };

  const card = await getCard(key);
  if (!card)                    return { statusCode: 200, headers: h, body: JSON.stringify({ success: false, message: '卡密不存在' }) };
  if (card.status !== 'active') return { statusCode: 200, headers: h, body: JSON.stringify({ success: false, message: '卡密已禁用' }) };
  if (card.remaining_times <= 0) return { statusCode: 200, headers: h, body: JSON.stringify({ success: false, message: '卡密次数已用完' }) };

  return { statusCode: 200, headers: h, body: JSON.stringify({ success: true, remaining_times: card.remaining_times }) };
};
