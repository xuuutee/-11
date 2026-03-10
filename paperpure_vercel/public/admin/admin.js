// admin.js
let token = null;
let allCards = [];
let genKeys = [];
let freeEnabled = true;

// ===== LOGIN =====
async function doLogin() {
  const user = document.getElementById('login-user').value.trim();
  const pass = document.getElementById('login-pass').value;
  const errEl = document.getElementById('login-err');
  errEl.style.display = 'none';
  try {
    const res = await fetch('/api/adminLogin', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: user, password: pass })
    });
    const data = await res.json();
    if (data.success) {
      token = data.token;
      sessionStorage.setItem('pp_token', token);
      sessionStorage.setItem('pp_user', user);
      enterApp(user);
    } else {
      errEl.textContent = data.message || '用户名或密码错误';
      errEl.style.display = 'block';
    }
  } catch (e) {
    errEl.textContent = '连接失败：' + e.message;
    errEl.style.display = 'block';
  }
}

function doLogout() {
  token = null;
  sessionStorage.removeItem('pp_token');
  sessionStorage.removeItem('pp_user');
  document.getElementById('admin-app').style.display = 'none';
  document.getElementById('login-screen').style.display = 'flex';
}

function enterApp(user) {
  document.getElementById('login-screen').style.display = 'none';
  document.getElementById('admin-app').style.display = 'block';
  const el = document.getElementById('acct-user');
  if (el) el.value = user || 'admin';
  loadStats();
}

window.addEventListener('DOMContentLoaded', async () => {
  const saved = sessionStorage.getItem('pp_token');
  const user  = sessionStorage.getItem('pp_user');
  if (!saved) return;
  token = saved;
  // 验证 token 是否仍有效
  try {
    const res = await fetch('/api/getStats', { headers: { 'x-admin-token': saved } });
    if (res.status === 401) throw new Error('expired');
    enterApp(user || 'admin');
  } catch {
    token = null;
    sessionStorage.removeItem('pp_token');
    sessionStorage.removeItem('pp_user');
  }
});

// ===== NAV =====
function go(name, el) {
  document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  document.getElementById('panel-' + name).classList.add('active');
  if (el) el.classList.add('active');
  if (name === 'cards')  loadCards();
  if (name === 'logs')   loadLogs();
  if (name === 'config') loadConfig();
}

// ===== API HELPER =====
async function api(url, body) {
  const opts = {
    method: body ? 'POST' : 'GET',
    headers: { 'Content-Type': 'application/json', 'x-admin-token': token }
  };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(url, opts);
  if (res.status === 401) { doLogout(); throw new Error('登录已过期'); }
  return res.json();
}

// ===== STATS =====
async function loadStats() {
  try {
    const d = await api('/api/getStats');
    setText('s-today', d.todayCount ?? 0);
    setText('s-total', d.totalCount ?? 0);
    setText('s-cards', d.cardCount ?? 0);
    setText('s-active', d.activeCardCount ?? 0);
    if (d.trend) renderTrend(d.trend);
    renderRecentLogs(d.recentLogs || []);
  } catch (e) { toast('统计加载失败：' + e.message); }
}

function renderTrend(trend) {
  const el = document.getElementById('trend-chart');
  const entries = Object.entries(trend);
  const max = Math.max(...entries.map(e => e[1]), 1);
  el.innerHTML = entries.map(([date, cnt]) => `
    <div class="trend-col">
      <div class="trend-val">${cnt}</div>
      <div class="trend-bar" style="height:${Math.max(3,(cnt/max)*58)}px" title="${date}: ${cnt}次"></div>
      <div class="trend-lbl">${date.slice(-5)}</div>
    </div>`).join('');
}

function renderRecentLogs(logs) {
  const el = document.getElementById('recent-tbody');
  el.innerHTML = logs.length === 0
    ? '<tr><td colspan="4" style="text-align:center;color:var(--text3);padding:24px">暂无记录</td></tr>'
    : logs.map(l => `<tr>
        <td class="time-cell">${fmt(l.created_at)}</td>
        <td><span class="key-mono">${l.card_key || '🎁 免费'}</span></td>
        <td>${l.char_count ?? '—'} 字</td>
        <td class="ip-cell">${l.ip || '—'}</td>
      </tr>`).join('');
}

// ===== CARDS =====
async function loadCards() {
  try {
    const d = await api('/api/manageCards', { action: 'list' });
    allCards = d.cards || [];
    renderCards(allCards);
  } catch (e) { toast('加载失败：' + e.message); }
}

function renderCards(cards) {
  const el = document.getElementById('cards-tbody');
  el.innerHTML = cards.length === 0
    ? '<tr><td colspan="5" style="text-align:center;color:var(--text3);padding:32px">暂无卡密</td></tr>'
    : cards.map(c => `<tr>
        <td><span class="key-mono">${c.card_key}</span></td>
        <td>${c.remaining_times}</td>
        <td><span class="badge ${c.status==='active'?'badge-green':'badge-red'}">${c.status==='active'?'启用':'禁用'}</span></td>
        <td class="time-cell">${fmt(c.created_at)}</td>
        <td style="display:flex;gap:6px;flex-wrap:wrap">
          <button class="btn btn-sm" onclick="openEdit('${c.card_key}',${c.remaining_times},'${c.status}')">编辑</button>
          <button class="btn btn-sm btn-danger" onclick="delCard('${c.card_key}')">删除</button>
        </td>
      </tr>`).join('');
}

function filterCards() {
  const q = document.getElementById('card-search').value.toUpperCase();
  renderCards(q ? allCards.filter(c => c.card_key.includes(q)) : allCards);
}

function exportCards() {
  if (!allCards.length) { toast('暂无卡密'); return; }
  const csv = '卡密,剩余次数,状态,创建时间\n' + allCards.map(c => `${c.card_key},${c.remaining_times},${c.status},${c.created_at}`).join('\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob(['\uFEFF'+csv], { type: 'text/csv;charset=utf-8' }));
  a.download = '卡密_'+new Date().toLocaleDateString('zh-CN').replace(/\//g,'')+'.csv';
  a.click(); toast('导出成功');
}

function openAdd() {
  document.getElementById('add-key').value = '';
  document.getElementById('add-times').value = '10';
  openModal('modal-add');
}

async function addCard() {
  const key   = document.getElementById('add-key').value.trim().toUpperCase();
  const times = parseInt(document.getElementById('add-times').value) || 10;
  try {
    const d = await api('/api/manageCards', { action: 'add', card_key: key, remaining_times: times });
    if (d.success) { toast('已添加：' + d.key); closeModal('modal-add'); loadCards(); }
    else toast('失败：' + d.message);
  } catch (e) { toast('操作失败'); }
}

function openEdit(key, times, status) {
  document.getElementById('edit-key-hidden').value = key;
  document.getElementById('edit-key-display').value = key;
  document.getElementById('edit-times').value = times;
  document.getElementById('edit-status').value = status;
  openModal('modal-edit');
}

async function saveEdit() {
  const key    = document.getElementById('edit-key-hidden').value;
  const times  = parseInt(document.getElementById('edit-times').value);
  const status = document.getElementById('edit-status').value;
  try {
    const d = await api('/api/manageCards', { action: 'update', card_key: key, remaining_times: times, status });
    if (d.success) { toast('保存成功'); closeModal('modal-edit'); loadCards(); }
    else toast('失败：' + d.message);
  } catch (e) { toast('操作失败'); }
}

async function delCard(key) {
  if (!confirm('确认删除 ' + key + '？')) return;
  try {
    await api('/api/manageCards', { action: 'delete', card_key: key });
    toast('已删除'); loadCards();
  } catch (e) { toast('失败'); }
}

// ===== BATCH =====
async function batchGen() {
  const count  = Math.min(parseInt(document.getElementById('gen-count').value) || 10, 500);
  const times  = parseInt(document.getElementById('gen-times').value) || 10;
  const prefix = document.getElementById('gen-prefix').value.trim().toUpperCase();
  try {
    const d = await api('/api/manageCards', { action: 'batch', count, times, prefix });
    if (d.success) {
      genKeys = d.keys;
      const box = document.getElementById('gen-box');
      box.style.display = 'block';
      box.innerHTML = d.keys.join('<br>');
      document.getElementById('gen-copy-row').style.display = 'block';
      toast('已生成 ' + d.keys.length + ' 个卡密');
    } else toast('失败：' + d.message);
  } catch (e) { toast('操作失败：' + e.message); }
}

async function copyKeys() {
  try { await navigator.clipboard.writeText(genKeys.join('\n')); toast('已复制'); }
  catch { toast('复制失败'); }
}

// ===== LOGS =====
async function loadLogs() {
  try {
    const d = await api('/api/getStats?type=logs');
    const el = document.getElementById('logs-tbody');
    const logs = d.logs || [];
    el.innerHTML = logs.length === 0
      ? '<tr><td colspan="4" style="text-align:center;color:var(--text3);padding:32px">暂无记录</td></tr>'
      : logs.map(l => `<tr>
          <td class="time-cell">${fmt(l.created_at)}</td>
          <td><span class="key-mono">${l.card_key || '🎁 免费'}</span></td>
          <td>${l.char_count ?? '—'} 字</td>
          <td class="ip-cell">${l.ip || '—'}</td>
        </tr>`).join('');
  } catch (e) { toast('加载失败'); }
}

// ===== CONFIG =====
async function loadConfig() {
  try {
    const d = await api('/api/getStats?type=config');
    freeEnabled = d.freeEnabled !== false;
    document.getElementById('toggle-free').classList.toggle('on', freeEnabled);
    document.getElementById('free-limit-input').value = d.freeLimit ?? 1;
    document.getElementById('notice-input').value = d.notice || '';
    checkApiKey();
  } catch (e) {}
}

async function checkApiKey() {
  const dot  = document.getElementById('api-dot');
  const text = document.getElementById('api-status-text');
  dot.className = 'api-dot'; text.textContent = '检测中…';
  try {
    const res = await fetch('/api/rewrite', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: '测试', mode: 'ping' })
    });
    const d = await res.json();
    if (d.apiKeyOk) { dot.className = 'api-dot ok'; text.textContent = '✅ 已配置，可正常使用'; }
    else            { dot.className = 'api-dot err'; text.textContent = '❌ 未配置，请在下方输入并保存'; }
  } catch (e) { dot.className = 'api-dot err'; text.textContent = '检测失败：' + e.message; }
}

async function saveApiKey() {
  const key = document.getElementById('api-key-input').value.trim();
  if (!key) { toast('请输入 API Key'); return; }
  if (!key.startsWith('sk-')) { toast('格式错误，应以 sk- 开头'); return; }
  const btn = document.getElementById('api-save-btn');
  btn.disabled = true; btn.textContent = '保存中…';
  try {
    const d = await api('/api/manageCards', { action: 'saveApiKey', kimiApiKey: key });
    if (d.success) {
      toast('✅ API Key 已保存到数据库');
      document.getElementById('api-key-input').value = '';
      checkApiKey();
    } else toast('保存失败：' + d.message);
  } catch (e) { toast('保存失败：' + e.message); }
  finally { btn.disabled = false; btn.textContent = '保存'; }
}

async function toggleFree() {
  freeEnabled = !freeEnabled;
  document.getElementById('toggle-free').classList.toggle('on', freeEnabled);
  try {
    await api('/api/manageCards', { action: 'saveConfig', config: { freeEnabled } });
    toast(freeEnabled ? '免费试用已开启' : '免费试用已关闭');
  } catch (e) { toast('保存失败'); }
}

async function saveFreeLimit() {
  const val = parseInt(document.getElementById('free-limit-input').value);
  if (isNaN(val) || val < 0) { toast('请输入有效次数'); return; }
  try {
    await api('/api/manageCards', { action: 'saveConfig', config: { freeLimit: val } });
    toast('已保存：' + val + ' 次');
  } catch (e) { toast('保存失败'); }
}

async function saveNotice() {
  const notice = document.getElementById('notice-input').value.trim();
  try {
    await api('/api/manageCards', { action: 'saveNotice', notice });
    toast(notice ? '公告已更新' : '公告已清除');
  } catch (e) { toast('保存失败'); }
}

function previewNotice() {
  const val = document.getElementById('notice-input').value.trim();
  const el  = document.getElementById('notice-preview');
  el.textContent = val; el.style.display = val ? 'block' : 'none';
}

// ===== ACCOUNT =====
async function changePass() {
  const p1 = document.getElementById('new-pass').value;
  const p2 = document.getElementById('new-pass2').value;
  if (!p1 || p1.length < 6) { toast('密码至少6位'); return; }
  if (p1 !== p2) { toast('两次密码不一致'); return; }
  try {
    const d = await api('/api/manageCards', { action: 'changePassword', password: p1 });
    if (d.success) { toast('修改成功，请重新登录'); setTimeout(doLogout, 1500); }
    else toast('失败：' + d.message);
  } catch (e) { toast('操作失败'); }
}

// ===== MODAL =====
function openModal(id)  { document.getElementById(id).classList.add('open'); }
function closeModal(id) { document.getElementById(id).classList.remove('open'); }
document.addEventListener('click', e => { if (e.target.classList.contains('modal-overlay')) e.target.classList.remove('open'); });

// ===== UTILS =====
function setText(id, val) { const el = document.getElementById(id); if (el) el.textContent = val; }
function fmt(ts) {
  if (!ts) return '—';
  try { return new Date(ts).toLocaleString('zh-CN', { month:'2-digit', day:'2-digit', hour:'2-digit', minute:'2-digit' }); }
  catch { return ts; }
}
function toast(msg) {
  const el = document.getElementById('toast');
  el.textContent = msg; el.classList.add('show');
  setTimeout(() => el.classList.remove('show'), 2500);
}
