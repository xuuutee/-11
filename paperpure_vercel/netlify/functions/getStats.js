// netlify/functions/getStats.js
const { getConfig, getCards, getLogs, getTodayCount, getTotalCount, getTrend } = require('./db');
const { verifyAdminToken } = require('./adminLogin');

exports.handler = async (event) => {
  const h = { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type,x-admin-token' };
  const type  = event.queryStringParameters?.type;
  const token = event.headers['x-admin-token'];

  // 公开 config（前端读取，无需 token）
  if (type === 'config' && !verifyAdminToken(token)) {
    const config = await getConfig();
    return { statusCode: 200, headers: h, body: JSON.stringify({
      freeEnabled: config.freeEnabled, freeLimit: config.freeLimit, notice: config.notice
    })};
  }

  if (!verifyAdminToken(token)) return { statusCode: 401, headers: h, body: JSON.stringify({ success: false, message: '未授权' }) };

  if (type === 'config') {
    const config = await getConfig();
    const mask = config.kimiApiKey ? config.kimiApiKey.slice(0, 8) + '••••••••' : '';
    return { statusCode: 200, headers: h, body: JSON.stringify({
      freeEnabled: config.freeEnabled, freeLimit: config.freeLimit,
      notice: config.notice, kimiApiKeyMask: mask, hasApiKey: !!config.kimiApiKey
    })};
  }

  if (type === 'logs') {
    const logs = await getLogs(200);
    return { statusCode: 200, headers: h, body: JSON.stringify({ logs }) };
  }

  const [cards, todayCount, totalCount, trend, recentLogs] = await Promise.all([
    getCards(), getTodayCount(), getTotalCount(), getTrend(), getLogs(10)
  ]);
  const activeCards = cards.filter(c => c.status === 'active' && c.remaining_times > 0);

  return { statusCode: 200, headers: h, body: JSON.stringify({
    todayCount, totalCount, cardCount: cards.length, activeCardCount: activeCards.length, trend, recentLogs
  })};
};
