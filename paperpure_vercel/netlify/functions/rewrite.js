// netlify/functions/rewrite.js
const { getConfig, getCard, updateCard, addLog, checkAndConsumeIpFree, atomicDecrCard, checkDetectRateLimit } = require('./db');
const { verifyAdminToken } = require('./adminLogin');

const MAX_WORDS = 5000;

const PROMPTS = {
  // 第一步：打散句子结构
  step1: `把下面文本拆解重组，改变句子顺序和结构，但不要改变原意，适当增加解释句。要求：
- 打乱原有的句子排列顺序，重新组织段落逻辑
- 把长句拆成短句，把短句合并成长句，长短随机交替
- 适当插入解释性句子，让内容更丰富自然
- 保留所有数据、专业术语和核心观点，不能删减内容
只输出处理后的文本，不加任何说明。`,

  // 第二步：降AI率改写
  step2: `请对下面文本进行降AI率改写，但不要改变原意。要求：
1. 保留原本意思，但改变句式结构，避免连续使用相同句式
2. 多加入一些口语化表达，让文本读起来像普通大学生写的
3. 适当增加"的、了、到、过、会、有、能、把"等自然停顿词
4. 不要使用"首先、其次、最后、综上所述、值得注意的是"这种AI常见结构
5. 可以适当增加一些解释性的表达，避免过于工整的段落逻辑
6. 随机使用：长句和短句混合、偶尔使用被动句、偶尔插入解释句
7. 让文本看起来自然随意，而不是AI生成的规整输出
8. 字数与原文保持接近，不得删减内容
输出改写后的完整文本，不加任何说明。`,

  // 第三步：同义词替换
  step3: (origLen) => `对下面文本进行同义词和近义词替换，进一步降低与原文的重合度。要求：
- 将常见学术词汇替换为含义相近但表达不同的词语
- 替换重复出现的词语，同一个词不要在一段内出现超过2次
- 保留所有数字、专有名词、专业术语不变
- 保持句子流畅自然，不要为了替换而替换生僻词
- 字数保持在 ${Math.round(origLen * 0.97)}~${Math.round(origLen * 1.06)} 字之间
只输出替换后的完整文本，不加任何说明。`,

  detect: `你是论文检测专家，同时分析AI率和查重率风险。
AI率：看句式是否刻板规整、千篇一律，缺乏真人写作的自然感。
查重率：看是否大量使用与文献相同的表达和套话。
输出格式（严格JSON，不要有任何多余文字）：
{"score":85,"level":"高风险","summary":"评估说明（2-3句）","issues":[{"text":"问题片段（25字内）","reason":"是AI率还是查重率问题及原因","suggestion":"具体修改建议"}]}`
};

function corsHeaders() {
  return { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Allow-Methods': 'POST,OPTIONS' };
}
function resp(code, msg) { return { statusCode: code, headers: corsHeaders(), body: JSON.stringify({ success: false, message: msg }) }; }

// 根据文本长度选择合适模型和 max_tokens
function pickModel(charCount) {
  // DeepSeek-chat 支持64k上下文，统一使用
  if (charCount <= 8000)  return { model: 'deepseek-chat', maxTokens: 4000 };
  return                         { model: 'deepseek-chat', maxTokens: 8000 };
}

async function callKimi(apiKey, systemPrompt, userContent, model, maxTokens, params = {}) {
  if (!model)     model     = 'moonshot-v1-8k';
  if (!maxTokens) maxTokens = 800;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 24000);
  try {
    const res = await fetch('https://api.deepseek.com/v1/chat/completions', {
      method: 'POST',
      signal: controller.signal,
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
      body: JSON.stringify({
        model,
        messages: [{ role: 'system', content: systemPrompt }, { role: 'user', content: userContent }],
        temperature: params.temperature ?? 1.0,
        top_p: params.top_p ?? 0.9,
        presence_penalty: params.presence_penalty ?? 0.6,
        frequency_penalty: params.frequency_penalty ?? 0.4,
        max_tokens: maxTokens
      })
    });
    if (!res.ok) { const t = await res.text(); console.error(`Kimi API错误 ${res.status}: ${t.slice(0,300)}`); throw new Error('AI服务请求失败，请稍后重试'); }
    const data = await res.json();
    const text = data.choices?.[0]?.message?.content;
    if (!text) throw new Error('AI返回内容为空');
    return text;
  } finally {
    clearTimeout(timeout);
  }
}

// 单步改写，由前端控制执行哪一步
async function rewriteOnce(apiKey, text, step, origLen) {
  const { model, maxTokens } = pickModel(text.replace(/\s/g,'').length);
  const params = { temperature: 1.0, top_p: 0.9, presence_penalty: 0.6, frequency_penalty: 0.4 };
  let prompt, userMsg;
  if (step === 1) {
    prompt = PROMPTS.step1;
    userMsg = `请处理以下文本：\n\n${text}`;
  } else if (step === 2) {
    prompt = PROMPTS.step2;
    userMsg = `请改写以下文本：\n\n${text}`;
  } else {
    prompt = PROMPTS.step3(origLen || text.replace(/\s/g,'').length);
    userMsg = `请对以下文本进行同义词替换：\n\n${text}`;
  }
  return await callKimi(apiKey, prompt, userMsg, model, maxTokens, params);
}


exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: corsHeaders(), body: '' };
  if (event.httpMethod !== 'POST') return resp(405, '方法不允许');

  let body;
  try { body = JSON.parse(event.body); } catch { return resp(400, '请求格式错误'); }

  const { text, cardKey, mode = 'rewrite', skipConsume = false } = body;
  const ip = (event.headers['x-forwarded-for'] || 'unknown').split(',')[0].trim();

  // ── ping：检测 API Key 是否可用
  if (mode === 'ping') {
    const config = await getConfig();
    const apiKey = process.env.DEEPSEEK_API_KEY || process.env.KIMI_API_KEY || config.kimiApiKey || '';
    return { statusCode: 200, headers: corsHeaders(), body: JSON.stringify({ apiKeyOk: !!apiKey }) };
  }

  if (!text || text.trim().length < 10) return resp(400, '文本内容过短（至少10字）');
  const charCount = text.replace(/\s/g, '').length;
  if (charCount > MAX_WORDS) return resp(400, `超出字数限制（最多${MAX_WORDS}字，当前${charCount}字）`);

  const config = await getConfig();
  const apiKey = process.env.DEEPSEEK_API_KEY || process.env.KIMI_API_KEY || config.kimiApiKey || '';
  if (!apiKey) return resp(500, '未配置 API Key，请在管理后台配置或设置环境变量 DEEPSEEK_API_KEY');

  // ── 检测（免费，限流每小时10次）
  if (mode === 'detect') {
    const allowed = await checkDetectRateLimit(ip);
    if (!allowed) return resp(429, '检测太频繁，请1小时后再试');
    try {
      const { model: dm, maxTokens: dt } = pickModel(text.length);
      const raw = await callKimi(apiKey, PROMPTS.detect, `请分析以下论文文本的AI特征：\n\n${text}`, dm, dt);
      const result = JSON.parse(raw.replace(/```json|```/g, '').trim());
      return { statusCode: 200, headers: corsHeaders(), body: JSON.stringify({ success: true, detection: result }) };
    } catch (e) { return resp(502, '检测失败：' + e.message); }
  }

  // ── 论文识别（免费）
  if (mode === 'identify') {
    try {
      const { model: im, maxTokens: it } = pickModel(text.length);
      const raw = await callKimi(apiKey, PROMPTS.identify, `请识别以下论文文本的结构：\n\n${text}`, im, it);
      const result = JSON.parse(raw.replace(/```json|```/g, '').trim());
      return { statusCode: 200, headers: corsHeaders(), body: JSON.stringify({ success: true, identify: result }) };
    } catch (e) { return resp(502, '识别失败：' + e.message); }
  }

  // ── 改写：验证卡密（分段时后续段 skipConsume=true 不扣次数）
  if (!cardKey && !skipConsume) return resp(403, '请输入卡密才能使用改写功能');
  let cardRecord = null;
  if (cardKey) {
    cardRecord = await getCard(cardKey.trim().toUpperCase());
    if (!cardRecord)                     return resp(403, '卡密无效');
    if (cardRecord.status !== 'active')  return resp(403, '卡密已被禁用');
    if (!skipConsume && cardRecord.remaining_times <= 0) return resp(403, '卡密次数已用完');
  }

  try {
    // 超过5000字使用分段改写，避免截断
    const step = body.step || 1;
    const origLen = body.origLen || text.replace(/\s/g,'').length;
    const result = await rewriteOnce(apiKey, text, step, origLen);

    if (cardRecord && !skipConsume) {
      // 原子扣减，防止并发超卖
      const updated = await atomicDecrCard(cardRecord.card_key);
      if (!updated) return resp(403, '卡密次数已用完');
      cardRecord.remaining_times = updated.remaining_times;
      await addLog({ card_key: cardKey, char_count: charCount, ip, type: 'card' });
    }

    return { statusCode: 200, headers: corsHeaders(), body: JSON.stringify({ success: true, result, remaining_times: cardRecord ? cardRecord.remaining_times : null }) };
  } catch (e) {
    console.error('Rewrite error:', e.message);
    return resp(502, 'AI服务暂时不可用，请稍后重试');
  }
};
