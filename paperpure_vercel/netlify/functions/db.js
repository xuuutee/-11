// netlify/functions/db.js
// 所有数据存 Supabase，彻底解决冷启动丢失问题

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY; // service_role key

function headers() {
  return {
    'Content-Type': 'application/json',
    'apikey': SUPABASE_KEY,
    'Authorization': `Bearer ${SUPABASE_KEY}`,
    'Prefer': 'return=representation'
  };
}

async function supabase(method, table, opts = {}) {
  if (!SUPABASE_URL || !SUPABASE_KEY) throw new Error('未配置 Supabase 环境变量');
  let url = `${SUPABASE_URL}/rest/v1/${table}`;
  if (opts.query) url += '?' + opts.query;
  const res = await fetch(url, {
    method,
    headers: { ...headers(), ...(opts.headers || {}) },
    body: opts.body ? JSON.stringify(opts.body) : undefined
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Supabase ${method} ${table}: ${res.status} ${text}`);
  return text ? JSON.parse(text) : null;
}

// ── 配置 ──
async function getConfig() {
  try {
    const rows = await supabase('GET', 'config', { query: 'key=in.(kimi_api_key,admin_user,admin_password,free_enabled,free_limit,notice)' });
    const cfg = { freeEnabled: true, freeLimit: 1, adminUser: 'admin', adminPassword: 'admin123', kimiApiKey: '', notice: '' };
    (rows || []).forEach(r => {
      if (r.key === 'kimi_api_key')    cfg.kimiApiKey      = r.value;
      if (r.key === 'admin_user')      cfg.adminUser       = r.value;
      if (r.key === 'admin_password')  cfg.adminPassword   = r.value;
      if (r.key === 'free_enabled')    cfg.freeEnabled     = r.value !== 'false';
      if (r.key === 'free_limit')      cfg.freeLimit       = parseInt(r.value) || 1;
      if (r.key === 'notice')          cfg.notice          = r.value;
    });
    return cfg;
  } catch(e) {
    return { freeEnabled: true, freeLimit: 1, adminUser: 'admin', adminPassword: 'admin123', kimiApiKey: '', notice: '' };
  }
}

async function setConfig(key, value) {
  await supabase('POST', 'config', {
    headers: { 'Prefer': 'resolution=merge-duplicates,return=representation' },
    body: { key, value: String(value) }
  });
}

// ── 卡密 ──
async function getCard(cardKey) {
  const rows = await supabase('GET', 'cards', { query: `card_key=eq.${encodeURIComponent(cardKey)}&limit=1` });
  return rows?.[0] || null;
}

async function getCards() {
  return await supabase('GET', 'cards', { query: 'order=created_at.desc' }) || [];
}

async function saveCard(card) {
  await supabase('POST', 'cards', {
    headers: { 'Prefer': 'resolution=merge-duplicates,return=representation' },
    body: card
  });
}

async function updateCard(cardKey, updates) {
  await supabase('PATCH', 'cards', {
    query: `card_key=eq.${encodeURIComponent(cardKey)}`,
    body: updates
  });
}

// 条件扣减：只在 remaining_times > 0 时更新，返回更新后的记录
async function atomicDecrCard(cardKey) {
  if (!SUPABASE_URL || !SUPABASE_KEY) throw new Error('未配置 Supabase 环境变量');
  // 先查询当前次数
  const rows = await supabase('GET', 'cards', {
    query: `card_key=eq.${encodeURIComponent(cardKey)}&limit=1`
  });
  const card = rows?.[0];
  if (!card || card.remaining_times <= 0) return null;
  // 带条件更新：remaining_times 必须还等于查到的值，防止并发
  const url = `${SUPABASE_URL}/rest/v1/cards?card_key=eq.${encodeURIComponent(cardKey)}&remaining_times=eq.${card.remaining_times}`;
  const res = await fetch(url, {
    method: 'PATCH',
    headers: { ...headers(), 'Prefer': 'return=representation' },
    body: JSON.stringify({ remaining_times: card.remaining_times - 1 })
  });
  const text = await res.text();
  const updated = text ? JSON.parse(text) : [];
  // 若更新到0行说明被并发抢占，重试一次
  if (!Array.isArray(updated) || updated.length === 0) {
    const retry = await supabase('GET', 'cards', { query: `card_key=eq.${encodeURIComponent(cardKey)}&limit=1` });
    const r = retry?.[0];
    if (!r || r.remaining_times <= 0) return null;
    await supabase('PATCH', 'cards', {
      query: `card_key=eq.${encodeURIComponent(cardKey)}`,
      body: { remaining_times: r.remaining_times - 1 }
    });
    return { ...r, remaining_times: r.remaining_times - 1 };
  }
  return updated[0];
}

async function deleteCard(cardKey) {
  await supabase('DELETE', 'cards', { query: `card_key=eq.${encodeURIComponent(cardKey)}` });
}

async function addCards(cards) {
  await supabase('POST', 'cards', { body: cards });
}

// ── 日志 ──
async function addLog(log) {
  await supabase('POST', 'logs', { body: { ...log, created_at: new Date().toISOString() } });
}

async function getLogs(limit = 100) {
  return await supabase('GET', 'logs', { query: `order=created_at.desc&limit=${limit}` }) || [];
}

async function getTodayCount() {
  const today = new Date().toISOString().slice(0, 10);
  const rows = await supabase('GET', 'logs', { query: `created_at=gte.${today}T00:00:00Z&select=id` });
  return rows?.length || 0;
}

async function getTotalCount() {
  const rows = await supabase('GET', 'logs', { query: 'select=id' });
  return rows?.length || 0;
}

// ── IP 免费次数 ──
async function checkAndConsumeIpFree(ip) {
  const cfg = await getConfig();
  if (!cfg.freeEnabled) return { allowed: false, reason: '免费试用已关闭' };
  const limit = cfg.freeLimit || 1;

  const rows = await supabase('GET', 'ip_usage', { query: `ip=eq.${encodeURIComponent(ip)}&limit=1` });
  const used = rows?.[0]?.count || 0;
  if (used >= limit) return { allowed: false, reason: `免费次数已用完（限${limit}次）` };

  if (rows?.[0]) {
    await supabase('PATCH', 'ip_usage', {
      query: `ip=eq.${encodeURIComponent(ip)}`,
      body: { count: used + 1 }
    });
  } else {
    await supabase('POST', 'ip_usage', { body: { ip, count: 1 } });
  }
  return { allowed: true, remaining: limit - used - 1 };
}

// ── 趋势 ──
async function getTrend() {
  const trend = {};
  for (let i = 6; i >= 0; i--) {
    const d = new Date(); d.setDate(d.getDate() - i);
    trend[d.toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit' })] = 0;
  }
  const logs = await getLogs(500);
  logs.forEach(l => {
    const k = new Date(l.created_at).toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit' });
    if (trend[k] !== undefined) trend[k]++;
  });
  return trend;
}

// 检测限流：每小时每IP最多10次
async function checkDetectRateLimit(ip) {
  try {
    const hourAgo = new Date(Date.now() - 3600000).toISOString();
    const rows = await supabase('GET', 'logs', {
      query: `ip=eq.${encodeURIComponent(ip)}&type=eq.detect&created_at=gte.${hourAgo}&select=id`
    });
    return (rows?.length || 0) < 10;
  } catch { return true; } // 查询失败则放行
}

module.exports = { getConfig, setConfig, getCard, getCards, saveCard, updateCard, deleteCard, addCards, addLog, getLogs, getTodayCount, getTotalCount, checkAndConsumeIpFree, getTrend, atomicDecrCard, checkDetectRateLimit };
