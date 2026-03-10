// XSS 防护
function escapeHtml(s) {
  if (!s) return '';
  return String(s).replace(/[&<>"]/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[m]));
}

const MAX_CHARS = 5000;
let verifiedCard = null;

// ── 初始化
window.addEventListener('DOMContentLoaded', async () => {
  try {
    const res = await fetch('/api/getStats?type=config');
    const cfg = await res.json();
    if (cfg.notice) {
      document.getElementById('notice-text').textContent = cfg.notice;
      document.getElementById('notice-bar').style.display = 'flex';
    }
  } catch(e) {}
});

// ── 字数统计
function updateWordCount() {
  const text = document.getElementById('input-text').value;
  const chars = text.replace(/\s/g,'').length;
  const el = document.getElementById('word-count');
  el.textContent = chars + ' / ' + MAX_CHARS + ' 字';
  el.style.color = chars > MAX_CHARS ? 'var(--red)' : 'var(--text3)';
  document.getElementById('clear-btn').style.display = text ? 'block' : 'none';
}

function clearInput() {
  document.getElementById('input-text').value = '';
  updateWordCount();
  document.getElementById('result-rewrite').style.display = 'none';
  document.getElementById('result-detect').style.display = 'none';
}

function getInputText() {
  return document.getElementById('input-text').value.trim();
}

// ── 切换功能 Tab
function switchTab(name) {
  document.querySelectorAll('.func-tab').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.func-panel').forEach(p => p.classList.remove('active'));
  document.getElementById('ftab-' + name).classList.add('active');
  document.getElementById('panel-' + name).classList.add('active');
}

// ── 验证卡密
async function verifyCard() {
  const key = document.getElementById('card-input').value.trim().toUpperCase();
  const statusEl = document.getElementById('card-status');
  if (!key) { showCardStatus('请输入卡密', 'err'); return; }
  const btn = document.getElementById('verify-btn');
  btn.disabled = true; btn.textContent = '验证中…';
  try {
    const res = await fetch('/api/verifyCard', {
      method: 'POST', headers: {'Content-Type':'application/json'},
      body: JSON.stringify({ key })
    });
    const d = await res.json();
    if (d.success) {
      verifiedCard = { key, times: d.remaining_times };
      showCardStatus('✓ 验证成功：' + key + '　剩余次数：' + d.remaining_times + ' 次', 'ok');
    } else {
      verifiedCard = null;
      showCardStatus('✗ ' + (d.message || '卡密无效'), 'err');
    }
  } catch(e) { showCardStatus('验证失败：' + e.message, 'err'); }
  finally { btn.disabled = false; btn.textContent = '验证'; }
}

function showCardStatus(msg, type) {
  const el = document.getElementById('card-status');
  el.textContent = msg;
  el.className = 'card-status ' + type;
  el.style.display = 'flex';
}

// ── 显示错误
function showError(msg) {
  const el = document.getElementById('error-box');
  document.getElementById('error-msg').textContent = msg;
  el.style.display = 'flex';
  el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

// ── Toast
function toast(msg) {
  const el = document.getElementById('toast');
  el.textContent = msg; el.classList.add('show');
  setTimeout(() => el.classList.remove('show'), 2500);
}

// 按段落切分，每块不超过 maxLen 字
function splitChunks(text, maxLen) {
  const paras = text.split(/\n{2,}/);
  const chunks = []; let cur = '';
  for (const p of paras) {
    if (cur && (cur.length + p.length + 2) > maxLen) { chunks.push(cur.trim()); cur = p; }
    else { cur += (cur ? '\n\n' : '') + p; }
  }
  if (cur.trim()) chunks.push(cur.trim());
  return chunks;
}

// ── 改写（前端分段，每段≤1500字，避免超时）
async function startRewrite() {
  const text = getInputText();
  if (!text || text.length < 10) { showError('请先输入论文内容（至少10字）'); return; }
  const chars = text.replace(/\s/g,'').length;
  if (chars > MAX_CHARS) { showError('文字超出 ' + MAX_CHARS + ' 字上限，当前 ' + chars + ' 字'); return; }
  if (!verifiedCard || verifiedCard.times <= 0) { showError('请先验证卡密，改写功能需要消耗1次次数'); return; }

  const btn = document.getElementById('rewrite-btn');
  btn.disabled = true;
  document.getElementById('error-box').style.display = 'none';
  document.getElementById('result-rewrite').style.display = 'none';

  const fill = document.getElementById('rw-fill'), txt = document.getElementById('rw-text');
  const prog = document.getElementById('rw-progress');
  prog.style.display = 'block'; fill.style.width = '3%'; txt.textContent = '正在准备改写…';

  try {
    const chunks = splitChunks(text, 250);
    const total = chunks.length;
    const results = [];
    let cardConsumed = false;

    // 每段发一个请求，后端完成三步流水线
    async function rewriteChunk(chunkText, isFirst) {
      const body = {
        text: chunkText, mode: 'rewrite',
        cardKey: isFirst ? verifiedCard.key : null,
        skipConsume: !isFirst
      };
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          const res = await fetch('/api/rewrite', {
            method: 'POST', headers: {'Content-Type':'application/json'},
            body: JSON.stringify(body)
          });
          if (!res.ok) {
            const e = await res.json().catch(()=>({}));
            const msg = e.message || ('服务器错误 ' + res.status);
            if (res.status === 403) throw new Error(msg);
            if (attempt === 1) return { success: false, fallback: chunkText };
            continue;
          }
          const data = await res.json();
          if (data.success) return { success: true, result: data.result, remaining_times: data.remaining_times };
          if (attempt === 1) return { success: false, fallback: chunkText };
        } catch(e) {
          if (e.message && e.message.includes('卡密')) throw e;
          if (attempt === 1) return { success: false, fallback: chunkText };
        }
      }
      return { success: false, fallback: chunkText };
    }

    for (let i = 0; i < total; i++) {
      const pct = Math.round(5 + (i / total) * 90) + '%';
      fill.style.width = pct;
      txt.textContent = total > 1 ? '改写第 ' + (i+1) + ' / ' + total + ' 段（三步改写中）…' : '三步深度改写中，请稍候…';

      const r = await rewriteChunk(chunks[i], !cardConsumed);
      if (!r.success) {
        results.push(r.fallback);
      } else {
        results.push(r.result);
        if (!cardConsumed && r.remaining_times !== null && r.remaining_times !== undefined) {
          verifiedCard.times = r.remaining_times;
          showCardStatus('✓ ' + verifiedCard.key + '　剩余次数：' + r.remaining_times + ' 次', 'ok');
        }
      }
      if (!cardConsumed) cardConsumed = true;
    }

    fill.style.width = '100%'; txt.textContent = '改写完成！';
    setTimeout(() => {
      prog.style.display = 'none';
      showRewriteResult(text, results.join('\n\n'));
    }, 400);
  } catch(e) {
    prog.style.display = 'none';
    showError(e.message || '改写失败，请重试');
  } finally {
    btn.disabled = false;
  }
}

function showRewriteResult(orig, rewritten) {
  document.getElementById('orig-box').textContent = orig;
  document.getElementById('new-box').value = rewritten;
  const origLen = orig.replace(/\s/g,'').length;
  const newLen = rewritten.replace(/\s/g,'').length;
  const diff = newLen - origLen;
  const sign = diff >= 0 ? '+' : '';
  document.getElementById('compare-badge').textContent = '原文 ' + origLen + ' 字 → 改写后 ' + newLen + ' 字（' + sign + diff + '）';
  const card = document.getElementById('result-rewrite');
  card.style.display = 'block';
  card.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function copyRewrite() {
  const text = document.getElementById('new-box').value;
  navigator.clipboard.writeText(text).then(() => toast('已复制到剪贴板')).catch(() => toast('复制失败'));
}

function downloadTxt() {
  const text = document.getElementById('new-box').value;
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' }));
  a.download = '改写结果_' + new Date().toLocaleDateString('zh-CN').replace(/\//g,'') + '.txt';
  a.click(); toast('下载成功');
}

// ── 检测
async function startDetect() {
  const text = getInputText();
  if (!text || text.length < 10) { showError('请先输入论文内容'); return; }
  const chars = text.replace(/\s/g,'').length;
  if (chars > MAX_CHARS) { showError('文字超出 ' + MAX_CHARS + ' 字上限'); return; }

  const btn = document.getElementById('detect-btn');
  btn.disabled = true;
  document.getElementById('error-box').style.display = 'none';
  document.getElementById('result-detect').style.display = 'none';

  const fill = document.getElementById('dt-fill'), txt = document.getElementById('dt-text');
  const prog = document.getElementById('dt-progress');
  prog.style.display = 'block'; fill.style.width = '10%'; txt.textContent = 'AI正在分析文本特征…';

  const steps = [{pct:'30%',msg:'识别AI句式特征…'},{pct:'60%',msg:'评估查重风险…'},{pct:'85%',msg:'生成改写建议…'}];
  let si = 0;
  const timer = setInterval(() => {
    if (si < steps.length) { fill.style.width = steps[si].pct; txt.textContent = steps[si].msg; si++; }
  }, 1500);

  try {
    const res = await fetch('/api/rewrite', {
      method: 'POST', headers: {'Content-Type':'application/json'},
      body: JSON.stringify({ text, mode: 'detect' })
    });
    clearInterval(timer);
    if (!res.ok) {
      let msg = '服务器错误 ' + res.status;
      try { const e = await res.json(); msg = e.message || msg; } catch(_) {}
      throw new Error(msg);
    }
    const data = await res.json();
    if (!data.success) throw new Error(data.message || '检测失败');
    fill.style.width = '100%'; txt.textContent = '检测完成！';
    setTimeout(() => { prog.style.display = 'none'; showDetectResult(data.detection); }, 300);
  } catch(e) {
    clearInterval(timer);
    prog.style.display = 'none';
    showError(e.message || '检测失败，请重试');
  } finally {
    btn.disabled = false;
  }
}

function showDetectResult(d) {
  const scoreClass = d.score >= 70 ? 'score-high' : d.score >= 40 ? 'score-mid' : 'score-low';
  let html = `<div class="detect-score-row">
    <div class="score-circle ${scoreClass}">${escapeHtml(String(d.score))}</div>
    <div class="score-info">
      <div class="score-level">${escapeHtml(d.level || '')}</div>
      <div class="score-summary">${escapeHtml(d.summary || '')}</div>
    </div>
  </div>`;

  if (d.issues && d.issues.length) {
    html += '<div class="issue-list">';
    d.issues.forEach((issue, i) => {
      const riskClass = i < 2 ? 'risk-high' : i < 4 ? 'risk-mid' : 'risk-low';
      html += `<div class="issue-item ${riskClass}">
        <div class="issue-text">「${escapeHtml(issue.text || '')}」</div>
        <div class="issue-reason"><strong>问题：</strong>${escapeHtml(issue.reason || '')}</div>
        <div class="issue-suggestion"><strong>建议：</strong>${escapeHtml(issue.suggestion || '')}</div>
      </div>`;
    });
    html += '</div>';
  } else {
    html += '<div class="detect-empty">✓ 未发现明显AI特征</div>';
  }

  document.getElementById('detect-body').innerHTML = html;
  const card = document.getElementById('result-detect');
  card.style.display = 'block';
  card.scrollIntoView({ behavior: 'smooth', block: 'start' });
}
