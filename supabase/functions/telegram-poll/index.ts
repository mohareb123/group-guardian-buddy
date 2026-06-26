import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const GATEWAY_URL = 'https://connector-gateway.lovable.dev/telegram';
const AI_GATEWAY_URL = 'https://ai.gateway.lovable.dev/v1/chat/completions';
const DEVELOPER_ID = 6570434162;

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// ==================== HELPERS ====================

function getEnv(name: string): string {
  const val = Deno.env.get(name);
  if (!val) throw new Error(`${name} is not configured`);
  return val;
}

function getHeaders() {
  return {
    'Authorization': `Bearer ${getEnv('LOVABLE_API_KEY')}`,
    'X-Connection-Api-Key': getEnv('TELEGRAM_API_KEY'),
    'Content-Type': 'application/json',
  };
}

function getSupabase() {
  return createClient(getEnv('SUPABASE_URL'), getEnv('SUPABASE_SERVICE_ROLE_KEY'));
}

async function tgCall(method: string, body: any) {
  const res = await fetch(`${GATEWAY_URL}/${method}`, {
    method: 'POST',
    headers: getHeaders(),
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`TG ${method} failed [${res.status}]: ${JSON.stringify(data)}`);
  return data;
}

// Upload raw bytes to Telegram via the connector gateway (multipart).
async function tgUpload(
  method: string,
  fields: Record<string, string | number>,
  files: { field: string; bytes: Uint8Array; filename: string; mime: string }[],
) {
  const form = new FormData();
  for (const [k, v] of Object.entries(fields)) form.append(k, String(v));
  for (const f of files) form.append(f.field, new Blob([f.bytes as unknown as BlobPart], { type: f.mime }), f.filename);
  const res = await fetch(`${GATEWAY_URL}/${method}`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${getEnv('LOVABLE_API_KEY')}`,
      'X-Connection-Api-Key': getEnv('TELEGRAM_API_KEY'),
    },
    body: form,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`TG ${method} upload failed [${res.status}]: ${JSON.stringify(data)}`);
  return data;
}

const BROWSER_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

// Download a remote file into memory with a size cap (Telegram bot upload limit ~50MB).
async function fetchBytes(
  url: string,
  maxBytes = 49 * 1024 * 1024,
  extraHeaders: Record<string, string> = {},
): Promise<{ bytes: Uint8Array; mime: string } | null> {
  try {
    const res = await fetch(url, { headers: { 'User-Agent': BROWSER_UA, 'Accept': '*/*', ...extraHeaders }, signal: AbortSignal.timeout(45000) });
    if (!res.ok || !res.body) return null;
    const declared = parseInt(res.headers.get('content-length') || '0');
    if (declared && declared > maxBytes) return null;
    const mime = res.headers.get('content-type') || 'application/octet-stream';
    const buf = new Uint8Array(await res.arrayBuffer());
    if (buf.byteLength === 0 || buf.byteLength > maxBytes) return null;
    return { bytes: buf, mime };
  } catch { return null; }
}

// Send a video by URL: try uploading real bytes first (most reliable), then remote URL, then link.
async function sendVideoSmart(chatId: number, videoUrl: string, caption: string, replyId?: number) {
  const got = await fetchBytes(videoUrl);
  if (got) {
    try {
      await tgUpload('sendVideo',
        { chat_id: chatId, caption, parse_mode: 'HTML', ...(replyId ? { reply_to_message_id: replyId } : {}), supports_streaming: 'true' },
        [{ field: 'video', bytes: got.bytes, filename: 'video.mp4', mime: got.mime.startsWith('video') ? got.mime : 'video/mp4' }]);
      return true;
    } catch (e) { console.error('sendVideoSmart upload failed:', e); }
  }
  try {
    await tgCall('sendVideo', { chat_id: chatId, video: videoUrl, caption, parse_mode: 'HTML', ...(replyId ? { reply_to_message_id: replyId } : {}) });
    return true;
  } catch (e) { console.error('sendVideoSmart url failed:', e); }
  await sendMsg(chatId, `${caption}\n🔗 ${escapeHtml(videoUrl)}`, undefined, replyId);
  return false;
}

// Send a photo by URL: try uploading real bytes first, then remote URL.
async function sendPhotoSmart(chatId: number, photoUrl: string, caption = '', replyId?: number) {
  const got = await fetchBytes(photoUrl, 9 * 1024 * 1024);
  if (got) {
    try {
      await tgUpload('sendPhoto',
        { chat_id: chatId, ...(caption ? { caption, parse_mode: 'HTML' } : {}), ...(replyId ? { reply_to_message_id: replyId } : {}) },
        [{ field: 'photo', bytes: got.bytes, filename: 'photo.jpg', mime: got.mime.startsWith('image') ? got.mime : 'image/jpeg' }]);
      return true;
    } catch (e) { console.error('sendPhotoSmart upload failed:', e); }
  }
  try {
    await tgCall('sendPhoto', { chat_id: chatId, photo: photoUrl, ...(caption ? { caption, parse_mode: 'HTML' } : {}), ...(replyId ? { reply_to_message_id: replyId } : {}) });
    return true;
  } catch { return false; }
}

async function sendMsg(chatId: number, text: string, replyMarkup?: any, replyToMessageId?: number) {
  return tgCall('sendMessage', {
    chat_id: chatId,
    text,
    parse_mode: 'HTML',
    ...(replyMarkup ? { reply_markup: replyMarkup } : {}),
    ...(replyToMessageId ? { reply_to_message_id: replyToMessageId } : {}),
  });
}

async function logAction(supabase: any, chatId: number, adminUserId: number, adminUsername: string, targetUserId: number, targetUsername: string, action: string, details?: string) {
  await supabase.from('telegram_admin_logs').insert({ chat_id: chatId, admin_user_id: adminUserId, admin_username: adminUsername, target_user_id: targetUserId, target_username: targetUsername, action, details });
}

async function ensureUser(supabase: any, userId: number, chatId: number, username?: string, firstName?: string, lastName?: string) {
  await supabase.from('telegram_users').upsert({
    user_id: userId, chat_id: chatId, username: username || null, first_name: firstName || null, last_name: lastName || null,
  }, { onConflict: 'user_id,chat_id' });
}

async function ensureGroup(supabase: any, chatId: number, title?: string) {
  await supabase.from('telegram_groups').upsert({ chat_id: chatId, title: title || null }, { onConflict: 'chat_id' });
}

async function isAdmin(chatId: number, userId: number): Promise<boolean> {
  try {
    const data = await tgCall('getChatMember', { chat_id: chatId, user_id: userId });
    return ['administrator', 'creator'].includes(data.result?.status);
  } catch { return false; }
}

function isDeveloper(userId: number): boolean { return userId === DEVELOPER_ID; }

async function notifyDeveloper(text: string) {
  try { await sendMsg(DEVELOPER_ID, text); } catch (e) { console.error('Notify dev error:', e); }
}

// Persist log entry to system_logs (visible in dashboard Console panel, realtime)
async function logSystem(
  level: 'info' | 'warn' | 'error' | 'debug',
  event: string,
  message?: string,
  context: Record<string, any> = {},
  chatId?: number,
  userId?: number,
) {
  try {
    const supabase = getSupabase();
    await supabase.from('system_logs').insert({
      level, source: 'telegram-poll', event,
      message: message?.slice(0, 1000) ?? null,
      context, chat_id: chatId ?? null, user_id: userId ?? null,
    });
  } catch (e) { console.error('logSystem failed:', e); }
}

async function withRetry<T>(fn: () => Promise<T>, attempts = 3, delayMs = 800): Promise<T> {
  let lastErr: any;
  for (let i = 0; i < attempts; i++) {
    try { return await fn(); } catch (e) {
      lastErr = e;
      if (i < attempts - 1) await new Promise(r => setTimeout(r, delayMs * (i + 1)));
    }
  }
  throw lastErr;
}

function humanError(context: string, err: any): string {
  const msg = String(err?.message || err || '');
  if (/429|rate/i.test(msg)) return `⏳ ${context}: السيرفر مضغوط شوية، جرّب بعد دقيقة 🙏`;
  if (/402|credit|quota/i.test(msg)) return `💳 ${context}: رصيد الخدمة خلص، أبلّغ المطور.`;
  if (/timeout|ETIMEDOUT|abort/i.test(msg)) return `🐢 ${context}: الاتصال بطيء، حاولت تاني ولم ينجح.`;
  if (/5\d\d/.test(msg)) return `🛠️ ${context}: في عطل بسيط من جهة الخدمة، جرّب بعد قليل.`;
  return `⚠️ ${context}: حصلت مشكلة بسيطة، جرّب تاني أو غيّر الصياغة.`;
}

async function callAI(prompt: string, systemPrompt: string, imageUrl?: string, model = 'google/gemini-2.5-flash'): Promise<string> {
  const userContent: any = imageUrl
    ? [{ type: 'text', text: prompt }, { type: 'image_url', image_url: { url: imageUrl } }]
    : prompt;

  return await withRetry(async () => {
    const res = await fetch(AI_GATEWAY_URL, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${getEnv('LOVABLE_API_KEY')}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        messages: [{ role: 'system', content: systemPrompt }, { role: 'user', content: userContent }],
      }),
    });
    if (res.status === 429 || res.status >= 500) throw new Error(`AI ${res.status}`);
    if (!res.ok) {
      const t = await res.text().catch(() => '');
      throw new Error(`AI ${res.status}: ${t}`);
    }
    const data = await res.json();
    return data.choices?.[0]?.message?.content || '';
  }, 3, 1000);
}

// ==================== AI IMAGE GENERATION ====================
async function generateAIImage(prompt: string): Promise<string | null> {
  return await withRetry(async () => {
    const res = await fetch(AI_GATEWAY_URL, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${getEnv('LOVABLE_API_KEY')}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'google/gemini-2.5-flash-image-preview',
        messages: [{ role: 'user', content: prompt }],
        modalities: ['image', 'text'],
      }),
    });
    if (res.status === 429 || res.status >= 500) throw new Error(`IMG ${res.status}`);
    if (!res.ok) { const t = await res.text().catch(() => ''); throw new Error(`IMG ${res.status}: ${t}`); }
    const data = await res.json();
    const imgs = data.choices?.[0]?.message?.images;
    return imgs?.[0]?.image_url?.url || null;
  }, 2, 1500);
}

async function sendAIImage(chatId: number, prompt: string, messageId?: number) {
  try {
    const dataUrl = await generateAIImage(prompt);
    if (!dataUrl) { await sendMsg(chatId, '❌ معرفتش أولّد الصورة دلوقتي، جرّب وصف تاني.', undefined, messageId); return; }
    // dataUrl is base64 → upload as multipart photo
    const base64 = dataUrl.split(',')[1] || '';
    const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
    const form = new FormData();
    form.append('chat_id', String(chatId));
    form.append('caption', `🎨 ${prompt.slice(0, 200)}`);
    if (messageId) form.append('reply_to_message_id', String(messageId));
    form.append('photo', new Blob([bytes], { type: 'image/png' }), 'image.png');
    const res = await fetch('https://connector-gateway.lovable.dev/telegram/sendPhoto', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${getEnv('LOVABLE_API_KEY')}`, 'X-Connection-Api-Key': getEnv('TELEGRAM_API_KEY') },
      body: form,
    });
    if (!res.ok) {
      console.error('sendAIImage failed', res.status, await res.text().catch(() => ''));
      await sendMsg(chatId, '❌ فشل إرسال الصورة المولّدة.', undefined, messageId);
    }
  } catch (e) {
    console.error('generateAIImage error:', e);
    await sendMsg(chatId, humanError('توليد الصورة', e), undefined, messageId);
  }
}

// ==================== CELEBRATION (task completion) ====================
async function getConfig(supabase: any, key: string): Promise<string | null> {
  try {
    const { data } = await supabase.from('telegram_config').select('value').eq('key', key).single();
    return data?.value || null;
  } catch { return null; }
}

async function sendCelebration(supabase: any, chatId: number, caption: string) {
  // Try a configured celebration video first, then animation, then plain message
  const videoId = await getConfig(supabase, 'celebration_video');
  if (videoId) {
    try {
      await tgCall('sendVideo', { chat_id: chatId, video: videoId, caption, parse_mode: 'HTML' });
      return;
    } catch (e) { console.error('celebration video failed:', e); }
  }
  const animId = await getConfig(supabase, 'celebration_animation');
  if (animId) {
    try {
      await tgCall('sendAnimation', { chat_id: chatId, animation: animId, caption, parse_mode: 'HTML' });
      return;
    } catch (e) { console.error('celebration animation failed:', e); }
  }
  await sendMsg(chatId, `${caption}\n\n🎊🎉🥳🎈`);
}

const PISTON_LANGS: Record<string, { language: string; version: string }> = {
  python: { language: 'python', version: '3.10.0' },
  py: { language: 'python', version: '3.10.0' },
  js: { language: 'javascript', version: '18.15.0' },
  javascript: { language: 'javascript', version: '18.15.0' },
  node: { language: 'javascript', version: '18.15.0' },
  ts: { language: 'typescript', version: '5.0.3' },
  bash: { language: 'bash', version: '5.2.0' },
  sh: { language: 'bash', version: '5.2.0' },
};

async function executeCode(lang: string, code: string): Promise<string> {
  const cfg = PISTON_LANGS[lang.toLowerCase()];
  if (!cfg) return `❌ اللغة غير مدعومة. المدعوم: python, javascript, typescript, bash`;
  try {
    const result = await withRetry(async () => {
      const res = await fetch('https://emkc.org/api/v2/piston/execute', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          language: cfg.language,
          version: cfg.version,
          files: [{ content: code }],
          stdin: '',
          compile_timeout: 10000,
          run_timeout: 8000,
        }),
      });
      if (!res.ok) throw new Error(`piston ${res.status}`);
      return await res.json();
    }, 2, 1500);

    const run = result.run || {};
    const compile = result.compile || {};
    const out = (compile.stderr || '') + (run.stdout || '') + (run.stderr || '');
    const trimmed = out.trim() || '(لا يوجد مخرج)';
    const truncated = trimmed.length > 3500 ? trimmed.slice(0, 3500) + '\n...[مقطوع]' : trimmed;
    const status = run.code === 0 ? '✅' : `⚠️ exit=${run.code}`;
    return `${status} <b>${cfg.language}</b>\n<pre>${escapeHtml(truncated)}</pre>`;
  } catch (e) {
    return humanError('تشغيل الكود', e);
  }
}

// ==================== HOSTED PROJECTS (multi-file Piston runtime) ====================

type HostedFile = { name: string; content: string };

async function runHostedProject(project: any): Promise<{ ok: boolean; output: string; exitCode: number; durationMs: number; stdout: string; stderr: string }> {
  const cfg = PISTON_LANGS[(project.language || 'python').toLowerCase()];
  if (!cfg) return { ok: false, output: '❌ لغة المشروع غير مدعومة', exitCode: -1, durationMs: 0, stdout: '', stderr: 'unsupported language' };
  const files: HostedFile[] = Array.isArray(project.files) && project.files.length > 0
    ? project.files
    : [{ name: cfg.language === 'python' ? 'main.py' : cfg.language === 'javascript' ? 'main.js' : 'main.txt', content: '' }];
  const t0 = Date.now();
  try {
    const result = await withRetry(async () => {
      const res = await fetch('https://emkc.org/api/v2/piston/execute', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          language: cfg.language, version: cfg.version,
          files: files.map(f => ({ name: f.name, content: f.content })),
          stdin: project.stdin || '',
          compile_timeout: 10000, run_timeout: 10000,
        }),
      });
      if (!res.ok) throw new Error(`piston ${res.status}`);
      return await res.json();
    }, 2, 1500);
    const run = result.run || {}; const compile = result.compile || {};
    const stdout = (run.stdout || '').toString();
    const stderr = ((compile.stderr || '') + (run.stderr || '')).toString();
    const exitCode = typeof run.code === 'number' ? run.code : -1;
    const durationMs = Date.now() - t0;
    const combined = (stdout + (stderr ? '\n--- STDERR ---\n' + stderr : '')).trim() || '(لا يوجد مخرج)';
    return { ok: exitCode === 0, output: combined, exitCode, durationMs, stdout, stderr };
  } catch (e: any) {
    return { ok: false, output: humanError('تشغيل المشروع', e), exitCode: -1, durationMs: Date.now() - t0, stdout: '', stderr: String(e?.message || e) };
  }
}

// Allowed extensions for hosting uploads (security: blocks executables, archives, encrypted files)
const ALLOWED_HOST_EXTENSIONS = ['.py', '.js', '.mjs', '.ts', '.sh', '.bash', '.txt', '.json', '.md', '.yml', '.yaml', '.toml', '.env', '.html', '.css', '.csv', '.xml'];
const HOST_MAX_FILE_BYTES = 512 * 1024; // 512KB per file

function isAllowedHostFile(name: string): boolean {
  const lower = (name || '').toLowerCase();
  return ALLOWED_HOST_EXTENSIONS.some(ext => lower.endsWith(ext));
}

async function downloadTgFileText(fileId: string, maxBytes = HOST_MAX_FILE_BYTES): Promise<string | null> {
  try {
    const info = await tgCall('getFile', { file_id: fileId });
    const filePath = info?.result?.file_path; if (!filePath) return null;
    const res = await fetch(`${GATEWAY_URL}/file/${filePath}`, { headers: { 'Authorization': `Bearer ${getEnv('LOVABLE_API_KEY')}`, 'X-Connection-Api-Key': getEnv('TELEGRAM_API_KEY') } });
    if (!res.ok) return null;
    const buf = await res.arrayBuffer();
    if (buf.byteLength > maxBytes) return null;
    // Reject binary files (executables, archives) by checking magic bytes
    const head = new Uint8Array(buf.slice(0, 4));
    if (head[0] === 0x4d && head[1] === 0x5a) return null; // MZ (Windows exe)
    if (head[0] === 0x7f && head[1] === 0x45 && head[2] === 0x4c && head[3] === 0x46) return null; // ELF
    if (head[0] === 0x50 && head[1] === 0x4b) return null; // ZIP/JAR/RAR
    return new TextDecoder('utf-8').decode(buf);
  } catch { return null; }
}

function inferLangFromFilename(name: string): string {
  const n = name.toLowerCase();
  if (n.endsWith('.py')) return 'python';
  if (n.endsWith('.js') || n.endsWith('.mjs')) return 'javascript';
  if (n.endsWith('.ts')) return 'typescript';
  if (n.endsWith('.sh') || n.endsWith('.bash')) return 'bash';
  return 'python';
}

// ==================== UI: MENU KEYBOARDS ====================

function mainMenuKeyboard(botUsername: string, inGroup = false): any[][] {
  const rows: any[][] = [
    [
      { text: '🔴 🛡️ الحماية', callback_data: 'menu:protect' },
      { text: '🟡 👑 الإدارة', callback_data: 'menu:admin' },
    ],
    [
      { text: '🔵 ☁️ الاستضافة', callback_data: 'menu:host' },
      { text: '🟣 🤖 فادي AI', callback_data: 'menu:ai' },
    ],
    [
      { text: '🟢 💰 الاقتصاد', callback_data: 'menu:economy' },
      { text: '🟠 🔍 البحث', callback_data: 'menu:search' },
    ],
    [
      { text: '⚪ 📥 تنزيل ميديا', callback_data: 'menu:media' },
      { text: '🟤 🎮 الترفيه', callback_data: 'menu:fun' },
    ],
    [
      { text: '⚫ 📋 كل الأوامر', callback_data: 'menu:help' },
      { text: '💎 👨‍💻 المطور', url: `tg://user?id=${DEVELOPER_ID}` },
    ],
  ];
  if (!inGroup) rows.push([{ text: '✨ ➕ أضفني لمجموعتك', url: `https://t.me/${botUsername}?startgroup=true` }]);
  return rows;
}

function helpCategoriesKeyboard(): any[][] {
  return [
    [{ text: '🔵 ☁️ استضافة', callback_data: 'help:host' }, { text: '🟣 🤖 ذكاء', callback_data: 'help:ai' }],
    [{ text: '🟡 👑 إدارة', callback_data: 'help:admin' }, { text: '🔴 🛡️ حماية', callback_data: 'help:protect' }],
    [{ text: '🟢 💰 اقتصاد', callback_data: 'help:economy' }, { text: '🟠 🔍 بحث', callback_data: 'help:search' }],
    [{ text: '⚪ 📥 ميديا', callback_data: 'help:media' }, { text: '🟤 🎮 ترفيه', callback_data: 'help:fun' }],
    [{ text: '⚫ 📋 الكل', callback_data: 'help:all' }, { text: '🏠 القائمة الرئيسية', callback_data: 'menu:main' }],
  ];
}

function helpMenuText(cat: string): string {
  const sections: Record<string, string> = {
    host:
`☁️ <b>منصة الاستضافة</b>\n━━━━━━━━━━━━━━\nشغّل وعدّل مشاريعك Python / JS / TS / Bash مع تخزين دائم.\n\n• <code>/host new &lt;الاسم&gt; &lt;اللغة&gt;</code> — أنشئ مشروع جديد\n• <code>/host upload &lt;الاسم&gt;</code> — ردّ على ملف لإضافته\n• <code>/host list</code> — كل مشاريعك\n• <code>/host code &lt;الاسم&gt;</code> — عرض الملفات\n• <code>/host run &lt;الاسم&gt;</code> — تشغيل المشروع\n• <code>/host logs &lt;الاسم&gt;</code> — آخر مخرج\n• <code>/host delete &lt;الاسم&gt;</code> — حذف\n\n⚡ كمان: <code>/run python كود</code> للتشغيل السريع.`,
    ai:
`🤖 <b>فادي — الوكيل الذكي</b>\n━━━━━━━━━━━━━━\nنادي عليه بكلمة <b>فادي</b> داخل أي رسالة. يفهم الصور، النصوص، والأوامر الإدارية بلغة طبيعية.\n\nأمثلة:\n• "فادي اكتم اللي رد دي ساعة"\n• "فادي حلل الصورة دي"\n• "فادي لخصلي آخر 10 رسائل"`,
    admin:
`👑 <b>أوامر الإدارة</b>\n━━━━━━━━━━━━━━\n/ban /unban /kick /mute /unmute\n/warn /unwarn /promote /demote\n/pin /unpin /report\n/tagall /all`,
    protect:
`🛡️ <b>الحماية</b>\n━━━━━━━━━━━━━━\n/lock /unlock /antispam /antiflood\n/nightmode /captcha /toxicity\n/slowmode /blacklist /restrict_new\n/security — عرض حالة الحماية الكاملة`,
    economy:
`💰 <b>الاقتصاد</b>\n━━━━━━━━━━━━━━\n/coins /daily /shop /buy\n/gift /transfer /top /points\n/profile /trust /reputation`,
    search:
`🔍 <b>البحث والأدوات</b>\n━━━━━━━━━━━━━━\n/searchweb — بحث في الويب 🌐\n/image — بحث عن صور وتنزيلها 🖼️\n/searchbook — بحث عن كتب 📚\n/searchfile — بحث عن ملفات (PDF/ZIP/MP3) 📂\n/searchyt — بحث في يوتيوب 🎬\n/browse — تصفح تفاعلي وتلخيص صفحة 🌐\n/screenshot — لقطة شاشة لأي موقع (كروم) 📸\n/open — افتح موقع + صورة + تلخيص 🖥️\n/get — تنزيل أي ملف برابط مباشر ⬇️`,
    media:
`📥 <b>تنزيل الميديا</b>\n━━━━━━━━━━━━━━\n/download &lt;رابط&gt; — فيديو (يوتيوب/تيك توك/انستغرام/X)\n/get &lt;رابط&gt; — أي ملف مباشر\n/image &lt;بحث&gt; — صور`,
    tools:
`🧰 <b>أدوات مفيدة</b>\n━━━━━━━━━━━━━━\n🌤️ /weather &lt;مدينة&gt; — الطقس\n💰 /crypto &lt;عملة&gt; — أسعار العملات الرقمية\n🌍 /translate &lt;لغة&gt; &lt;نص&gt; — ترجمة\n📱 /qr &lt;نص/رابط&gt; — توليد QR Code\n📰 /rss &lt;رابط&gt; — قراءة تغذية RSS`,
    fun:
`🎮 <b>الترفيه والتفاعل</b>\n━━━━━━━━━━━━━━\n/quiz /game /truth /dare\n/joke /hack /roll /flip /random\n/whisper — همسة سرية\n/court — محكمة المجموعة\n/challenge /mychallenges`,
    all:
`📋 <b>دليل الأوامر الكامل</b>\n━━━━━━━━━━━━━━\n☁️ استضافة • 🤖 فادي • 👑 إدارة\n🛡️ حماية • 💰 اقتصاد • 🔍 بحث\n📥 ميديا • 🧰 أدوات • 🎮 ترفيه\n\n🔍 <b>بحث:</b> /searchweb /image /searchfile /searchbook /searchyt /browse\n⬇️ <b>تنزيل:</b> /download /get\n🧰 <b>أدوات:</b> /weather /crypto /translate /qr /rss\n\n💡 /menu — القائمة الرئيسية | /dev — المطور`,
  };
  return sections[cat] || sections.all;
}

// ==================== YOUTUBE (cookies + InnerTube) ====================

// Public InnerTube web key (not secret)
const YT_INNERTUBE_KEY = 'AIzaSyAO_FJ2SlqU8Q4STEHLGCilw_Y9_11qcW8';

let _ytCookieCache: { value: string | null; at: number } | null = null;

// Reads YouTube cookies stored in telegram_config (pipe-separated) and
// returns a proper "name=value; name=value" Cookie header string.
async function getYouTubeCookies(supabase: any): Promise<string | null> {
  try {
    if (_ytCookieCache && Date.now() - _ytCookieCache.at < 60_000) return _ytCookieCache.value;
    const raw = await getConfig(supabase, 'youtube_cookies');
    const value = raw ? raw.split('|').map((p: string) => p.trim()).filter(Boolean).join('; ') : null;
    _ytCookieCache = { value, at: Date.now() };
    return value;
  } catch { return null; }
}

function _ytCookieCacheClear() { _ytCookieCache = null; }

function getCookieValue(cookieHeader: string, name: string): string | null {
  const m = cookieHeader.match(new RegExp(`(?:^|;\\s*)${name}=([^;]+)`));
  return m ? m[1] : null;
}

// Builds the SAPISIDHASH Authorization header Google requires for authenticated
// requests made from a non-browser client using account cookies.
async function buildSapisidHash(cookieHeader: string, origin = 'https://www.youtube.com'): Promise<string | null> {
  const sapisid = getCookieValue(cookieHeader, 'SAPISID')
    || getCookieValue(cookieHeader, '__Secure-3PAPISID')
    || getCookieValue(cookieHeader, '__Secure-1PAPISID');
  if (!sapisid) return null;
  const ts = Math.floor(Date.now() / 1000);
  const data = new TextEncoder().encode(`${ts} ${sapisid} ${origin}`);
  const digest = await crypto.subtle.digest('SHA-1', data);
  const hex = Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('');
  return `SAPISIDHASH ${ts}_${hex}`;
}

async function ytAuthHeaders(cookieHeader: string | null): Promise<Record<string, string>> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Origin': 'https://www.youtube.com',
    'X-Origin': 'https://www.youtube.com',
    'X-YouTube-Client-Name': '1',
    'X-YouTube-Client-Version': '2.20240101.00.00',
  };
  if (cookieHeader) {
    headers['Cookie'] = cookieHeader;
    const auth = await buildSapisidHash(cookieHeader);
    if (auth) {
      headers['Authorization'] = auth;
      headers['X-Goog-AuthUser'] = '0';
    }
  }
  return headers;
}

// Real YouTube search using the InnerTube API with account cookies.
async function ytInnertubeSearch(query: string, cookieHeader: string | null): Promise<SearchResult[]> {
  const headers = await ytAuthHeaders(cookieHeader);
  const res = await fetch(`https://www.youtube.com/youtubei/v1/search?key=${YT_INNERTUBE_KEY}&prettyPrint=false`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      context: { client: { clientName: 'WEB', clientVersion: '2.20240101.00.00', hl: 'ar', gl: 'EG' } },
      query,
    }),
  });
  if (!res.ok) throw new Error(`InnerTube search failed [${res.status}]`);
  const data = await res.json();
  const sections = data?.contents?.twoColumnSearchResultsRenderer?.primaryContents?.sectionListRenderer?.contents || [];
  const out: SearchResult[] = [];
  for (const sec of sections) {
    const items = sec?.itemSectionRenderer?.contents || [];
    for (const it of items) {
      const v = it?.videoRenderer;
      if (!v?.videoId) continue;
      const title = v.title?.runs?.[0]?.text || v.title?.simpleText || '';
      const channel = v.ownerText?.runs?.[0]?.text || v.longBylineText?.runs?.[0]?.text || '';
      const views = v.shortViewCountText?.simpleText || '';
      const dur = v.lengthText?.simpleText || '';
      if (!title) continue;
      out.push({
        title: cleanText(title, 140),
        url: `https://www.youtube.com/watch?v=${v.videoId}`,
        snippet: cleanText(`${channel}${views ? ` · ${views}` : ''}${dur ? ` · ${dur}` : ''}`, 180),
      });
      if (out.length >= 6) break;
    }
    if (out.length >= 6) break;
  }
  return out;
}

function extractYouTubeId(url: string): string | null {
  const m = url.match(/(?:youtube\.com\/(?:watch\?v=|shorts\/|embed\/|v\/)|youtu\.be\/)([A-Za-z0-9_-]{11})/);
  return m ? m[1] : null;
}

// Uses InnerTube player (ANDROID + cookies) to get a direct, progressive
// (audio+video) stream URL that Telegram can fetch without deciphering.
async function ytInnertubePlayer(videoId: string, cookieHeader: string | null): Promise<string | null> {
  try {
    const headers = await ytAuthHeaders(cookieHeader);
    const res = await fetch(`https://www.youtube.com/youtubei/v1/player?key=${YT_INNERTUBE_KEY}&prettyPrint=false`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        context: {
          client: {
            clientName: 'ANDROID',
            clientVersion: '19.09.37',
            androidSdkVersion: 30,
            hl: 'ar', gl: 'EG',
            userAgent: 'com.google.android.youtube/19.09.37 (Linux; U; Android 11) gzip',
          },
        },
        videoId,
      }),
    });
    if (!res.ok) return null;
    const data = await res.json();
    if (data?.playabilityStatus?.status && data.playabilityStatus.status !== 'OK') return null;
    const formats = data?.streamingData?.formats || [];
    // progressive formats include both audio + video with a direct url
    const mp4 = formats
      .filter((f: any) => f.url && /mp4/i.test(f.mimeType || '') && f.audioQuality)
      .sort((a: any, b: any) => (b.height || 0) - (a.height || 0));
    const pick = mp4[0] || formats.find((f: any) => f.url);
    return pick?.url || null;
  } catch { return null; }
}

// Extracts a direct audio-only stream URL (m4a/webm) for a YouTube video using
// the InnerTube ANDROID client + cookies. Falls back to progressive formats.
async function ytInnertubeAudio(videoId: string, cookieHeader: string | null): Promise<string | null> {
  try {
    const headers = await ytAuthHeaders(cookieHeader);
    const res = await fetch(`https://www.youtube.com/youtubei/v1/player?key=${YT_INNERTUBE_KEY}&prettyPrint=false`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        context: {
          client: {
            clientName: 'ANDROID',
            clientVersion: '19.09.37',
            androidSdkVersion: 30,
            hl: 'ar', gl: 'EG',
            userAgent: 'com.google.android.youtube/19.09.37 (Linux; U; Android 11) gzip',
          },
        },
        videoId,
      }),
    });
    if (!res.ok) return null;
    const data = await res.json();
    if (data?.playabilityStatus?.status && data.playabilityStatus.status !== 'OK') return null;
    const adaptive = data?.streamingData?.adaptiveFormats || [];
    const audio = adaptive
      .filter((f: any) => f.url && /audio/i.test(f.mimeType || ''))
      .sort((a: any, b: any) => (b.bitrate || 0) - (a.bitrate || 0));
    if (audio[0]?.url) return audio[0].url;
    // fallback: progressive (audio+video) stream
    const formats = data?.streamingData?.formats || [];
    const pick = formats.find((f: any) => f.url);
    return pick?.url || null;
  } catch { return null; }
}

// Extracts an audio stream for a YouTube video via Invidious (fallback).
async function tryInvidiousAudio(videoId: string): Promise<string | null> {
  for (const base of INVIDIOUS_INSTANCES) {
    try {
      const res = await fetch(`${base}/api/v1/videos/${videoId}`, {
        headers: { 'User-Agent': BROWSER_UA, 'Accept': 'application/json' },
        signal: AbortSignal.timeout(10000),
      });
      if (!res.ok) continue;
      const ct = res.headers.get('content-type') || '';
      if (!ct.includes('json')) continue;
      const data = await res.json();
      const audio = (data?.adaptiveFormats || [])
        .filter((s: any) => s?.url && /audio/i.test(s.type || ''))
        .sort((a: any, b: any) => (parseInt(b.bitrate) || 0) - (parseInt(a.bitrate) || 0));
      if (audio[0]?.url) return audio[0].url;
      const prog = (data?.formatStreams || []).find((s: any) => s?.url);
      if (prog?.url) return prog.url;
    } catch { continue; }
  }
  return null;
}

// Returns a downloadable audio URL for a YouTube video id (InnerTube → Invidious → Cobalt).
async function getYouTubeAudio(videoId: string, supabase?: any): Promise<string | null> {
  const cookies = supabase ? await getYouTubeCookies(supabase) : null;
  let url = await ytInnertubeAudio(videoId, cookies);
  if (!url) url = await tryInvidiousAudio(videoId);
  if (!url) url = await tryCobalt(`https://www.youtube.com/watch?v=${videoId}`);
  return url;
}

// Finds the best matching YouTube video id for a text query.
async function ytFindVideoId(query: string, supabase?: any): Promise<string | null> {
  try {
    const cookies = supabase ? await getYouTubeCookies(supabase) : null;
    const results = await ytInnertubeSearch(query, cookies);
    for (const r of results) {
      const id = extractYouTubeId(r.url);
      if (id) return id;
    }
  } catch { /* ignore */ }
  // fallback: DuckDuckGo
  try {
    const results = await duckSearch(query, { youtubeOnly: true });
    for (const r of results) {
      const id = extractYouTubeId(r.url);
      if (id) return id;
    }
  } catch { /* ignore */ }
  return null;
}

// Send audio by URL: upload bytes first (most reliable), then remote URL, then link.
async function sendAudioSmart(chatId: number, audioUrl: string, opts: { caption?: string; title?: string; performer?: string; thumb?: string; replyId?: number } = {}) {
  const { caption = '', title = '', performer = '', replyId } = opts;
  const got = await fetchBytes(audioUrl);
  if (got) {
    try {
      await tgUpload('sendAudio',
        { chat_id: chatId, ...(caption ? { caption, parse_mode: 'HTML' } : {}), ...(title ? { title } : {}), ...(performer ? { performer } : {}), ...(replyId ? { reply_to_message_id: replyId } : {}) },
        [{ field: 'audio', bytes: got.bytes, filename: `${(title || 'audio').replace(/[^\w\u0600-\u06FF .-]/g, '_').slice(0, 60)}.mp3`, mime: got.mime.startsWith('audio') ? got.mime : 'audio/mpeg' }]);
      return true;
    } catch (e) { console.error('sendAudioSmart upload failed:', e); }
  }
  try {
    await tgCall('sendAudio', { chat_id: chatId, audio: audioUrl, ...(caption ? { caption, parse_mode: 'HTML' } : {}), ...(title ? { title } : {}), ...(performer ? { performer } : {}), ...(replyId ? { reply_to_message_id: replyId } : {}) });
    return true;
  } catch (e) { console.error('sendAudioSmart url failed:', e); }
  await sendMsg(chatId, `${caption}\n🔗 ${escapeHtml(audioUrl)}`, undefined, replyId);
  return false;
}

// ==================== SPOTIFY (metadata search via cookies + YouTube audio) ====================

type SpotifyTrack = { title: string; artists: string; album: string; url: string; image?: string; durationMs?: number; videoId?: string };

let _spTokenCache: { token: string; exp: number } | null = null;

async function getSpotifyCookies(supabase: any): Promise<string | null> {
  try {
    const raw = await getConfig(supabase, 'spotify_cookies');
    return raw ? raw.split('|').map((p: string) => p.trim()).filter(Boolean).join('; ') : null;
  } catch { return null; }
}

// Gets a Spotify Web API access token (uses stored cookies when available).
async function getSpotifyToken(supabase: any): Promise<string | null> {
  if (_spTokenCache && Date.now() < _spTokenCache.exp - 30_000) return _spTokenCache.token;
  try {
    const cookie = await getSpotifyCookies(supabase);
    const res = await fetch('https://open.spotify.com/get_access_token?reason=transport&productType=web_player', {
      headers: {
        'User-Agent': BROWSER_UA,
        'Accept': 'application/json',
        'App-Platform': 'WebPlayer',
        ...(cookie ? { Cookie: cookie } : {}),
      },
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) return null;
    const data = await res.json().catch(() => null);
    if (!data?.accessToken) return null;
    _spTokenCache = { token: data.accessToken, exp: data.accessTokenExpirationTimestampMs || (Date.now() + 3_000_000) };
    return data.accessToken;
  } catch { return null; }
}

// Searches Spotify tracks metadata.
async function searchSpotify(query: string, supabase: any, limit = 5): Promise<SpotifyTrack[]> {
  const token = await getSpotifyToken(supabase);
  if (!token) return [];
  try {
    const res = await fetch(`https://api.spotify.com/v1/search?q=${encodeURIComponent(query)}&type=track&limit=${limit}`, {
      headers: { Authorization: `Bearer ${token}`, 'Accept': 'application/json' },
      signal: AbortSignal.timeout(12000),
    });
    if (!res.ok) return [];
    const data = await res.json();
    const items = data?.tracks?.items || [];
    return items.map((t: any) => ({
      title: t.name || '',
      artists: (t.artists || []).map((a: any) => a.name).join('، '),
      album: t.album?.name || '',
      url: t.external_urls?.spotify || '',
      image: t.album?.images?.[0]?.url,
      durationMs: t.duration_ms,
    })).filter((t: SpotifyTrack) => t.title);
  } catch (e) { console.error('searchSpotify error:', e); return []; }
}

function fmtDuration(ms?: number): string {
  if (!ms) return '';
  const s = Math.round(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

// ==================== VIDEO DOWNLOADER ====================

const COBALT_INSTANCES = [
  'https://cobalt-backend.canine.tools',
  'https://api.cobalt.tools',
  'https://co.eepy.today',
  'https://cobalt-api.kwiatekmiki.com',
  'https://nyc1.coba.lt',
];

async function tryCobalt(url: string): Promise<string | null> {
  for (const host of COBALT_INSTANCES) {
    try {
      const res = await fetch(`${host}/`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
        body: JSON.stringify({ url, videoQuality: '720', downloadMode: 'auto' }),
        signal: AbortSignal.timeout(8000),
      });
      if (!res.ok) continue;
      const data = await res.json().catch(() => null);
      if (!data) continue;
      if (data.status === 'tunnel' || data.status === 'stream' || data.status === 'redirect') {
        if (data.url) return data.url;
      }
      if (data.status === 'picker' && Array.isArray(data.picker) && data.picker[0]?.url) return data.picker[0].url;
      if (data.url) return data.url;
    } catch { continue; }
  }
  return null;
}

// Returns the full TikTok media payload: HD video and/or image slideshow.
async function getTikTokMedia(url: string): Promise<{ video?: string; images?: string[]; title?: string; music?: string } | null> {
  try {
    const res = await fetch(`https://www.tikwm.com/api/?url=${encodeURIComponent(url)}&hd=1`, {
      headers: { 'User-Agent': BROWSER_UA },
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) return null;
    const data = await res.json();
    const d = data?.data;
    if (!d) return null;
    const images: string[] = Array.isArray(d.images) ? d.images.filter(Boolean) : [];
    const video: string | undefined = d.hdplay || d.play || d.wmplay || undefined;
    const music: string | undefined = d.music || d.music_info?.play || undefined;
    if (images.length === 0 && !video) return null;
    return { video, images, title: d.title || '', music };
  } catch { return null; }
}

async function tryTikwm(url: string): Promise<string | null> {
  const m = await getTikTokMedia(url);
  return m?.video || null;
}

const INVIDIOUS_INSTANCES = [
  'https://iv.melmac.space',
  'https://invidious.nerdvpn.de',
  'https://yewtu.be',
  'https://inv.nadeko.net',
  'https://invidious.privacyredirect.com',
];

// Extracts a direct progressive (audio+video) YouTube stream via Invidious.
async function tryInvidious(videoId: string): Promise<string | null> {
  for (const base of INVIDIOUS_INSTANCES) {
    try {
      const res = await fetch(`${base}/api/v1/videos/${videoId}`, {
        headers: { 'User-Agent': BROWSER_UA, 'Accept': 'application/json' },
        signal: AbortSignal.timeout(10000),
      });
      if (!res.ok) continue;
      const ct = res.headers.get('content-type') || '';
      if (!ct.includes('json')) continue;
      const data = await res.json();
      const streams = (data?.formatStreams || []).filter((s: any) => s?.url);
      if (streams.length === 0) continue;
      // prefer highest resolution mp4 progressive
      streams.sort((a: any, b: any) => (parseInt(b.resolution) || 0) - (parseInt(a.resolution) || 0));
      return streams[0].url;
    } catch { continue; }
  }
  return null;
}

// Generic media extraction from any web page: OpenGraph / Twitter / <video> / <img> tags.
async function extractPageMedia(url: string): Promise<{ videos: string[]; images: string[] }> {
  const videos: string[] = [];
  const images: string[] = [];
  try {
    const res = await fetch(url, { headers: { 'User-Agent': BROWSER_UA, 'Accept-Language': 'ar,en;q=0.9' }, signal: AbortSignal.timeout(12000) });
    if (!res.ok) return { videos, images };
    const ct = res.headers.get('content-type') || '';
    if (/^video\//i.test(ct)) return { videos: [url], images };
    if (/^image\//i.test(ct)) return { videos, images: [url] };
    const html = await res.text();
    const base = new URL(url);
    const abs = (u: string) => { try { return new URL(decodeHtmlEntities(u), base).href; } catch { return ''; } };
    const push = (arr: string[], u: string) => { const a = abs(u); if (a && !arr.includes(a)) arr.push(a); };

    const metaPatterns = [
      /<meta[^>]+(?:property|name)=["'](?:og:video(?::secure_url|:url)?|twitter:player:stream)["'][^>]+content=["']([^"']+)["']/gi,
    ];
    for (const re of metaPatterns) for (const m of html.matchAll(re)) push(videos, m[1]);
    for (const m of html.matchAll(/<meta[^>]+(?:property|name)=["'](?:og:image(?::secure_url|:url)?|twitter:image(?::src)?)["'][^>]+content=["']([^"']+)["']/gi)) push(images, m[1]);

    for (const m of html.matchAll(/<video[^>]+src=["']([^"']+)["']/gi)) push(videos, m[1]);
    for (const m of html.matchAll(/<source[^>]+src=["']([^"']+\.(?:mp4|webm|m3u8)[^"']*)["']/gi)) push(videos, m[1]);
    for (const m of html.matchAll(/["'](https?:\/\/[^"']+\.mp4[^"']*)["']/gi)) push(videos, m[1]);
    if (images.length === 0) {
      for (const m of html.matchAll(/<img[^>]+src=["']([^"']+\.(?:jpg|jpeg|png|webp|gif)[^"']*)["']/gi)) push(images, m[1]);
    }
  } catch (e) { console.error('extractPageMedia error:', e); }
  return { videos: videos.slice(0, 5), images: images.slice(0, 10) };
}

async function downloadVideo(url: string, supabase?: any): Promise<{ ok: boolean; videoUrl?: string; message: string }> {
  const isTikTok = /tiktok\.com|vm\.tiktok|vt\.tiktok/i.test(url);
  const ytId = extractYouTubeId(url);
  let direct: string | null = null;

  // For YouTube: try InnerTube player with cookies, then Invidious instances
  if (ytId) {
    const cookies = supabase ? await getYouTubeCookies(supabase) : null;
    direct = await ytInnertubePlayer(ytId, cookies);
    if (!direct) direct = await tryInvidious(ytId);
  }

  // Generic fallbacks
  if (!direct && isTikTok) direct = await tryTikwm(url);
  if (!direct) direct = await tryCobalt(url);
  if (!direct) {
    const media = await extractPageMedia(url);
    if (media.videos.length) direct = media.videos[0];
  }
  if (!direct) {
    return { ok: false, message: '😕 ما قدرت أحمّل الفيديو من اللينك ده. جرّب لينك تاني أو تأكد إن الفيديو متاح للعموم.' };
  }
  return { ok: true, videoUrl: direct, message: '✅ تم استخراج الفيديو' };
}

// Unified download flow: TikTok (video+slideshow), YouTube, and any site with media.
async function handleDownload(chatId: number, rawUrl: string, supabase: any, replyId?: number) {
  const url = (rawUrl || '').trim();
  if (!url || !/^https?:\/\//i.test(url)) {
    await sendMsg(chatId, '📥 ابعت رابط صحيح:\n<code>/download https://...</code>\n\nمدعوم: تيك توك (فيديو + صور) / يوتيوب / إنستجرام / أي موقع فيه فيديو أو صور', undefined, replyId);
    return;
  }
  try { await tgCall('sendChatAction', { chat_id: chatId, action: 'upload_video' }); } catch { /* ignore */ }

  const isTikTok = /tiktok\.com|vm\.tiktok|vt\.tiktok/i.test(url);
  if (isTikTok) {
    const media = await getTikTokMedia(url);
    if (media?.images?.length) {
      const caption = `✅ ${media.title ? escapeHtml(media.title.slice(0, 200)) : 'صور تيك توك'}`;
      try {
        const group = media.images.slice(0, 10).map((img, i) => ({ type: 'photo', media: img, ...(i === 0 ? { caption, parse_mode: 'HTML' } : {}) }));
        await tgCall('sendMediaGroup', { chat_id: chatId, media: group });
      } catch {
        for (const img of media.images.slice(0, 10)) await sendPhotoSmart(chatId, img);
      }
      if (media.music) { try { await tgCall('sendAudio', { chat_id: chatId, audio: media.music, caption: '🎵 الصوت' }); } catch { /* ignore */ } }
      return;
    }
    if (media?.video) { await sendVideoSmart(chatId, media.video, '✅ تفضّل فيديو تيك توك', replyId); return; }
  }

  const res = await downloadVideo(url, supabase);
  if (res.ok && res.videoUrl) { await sendVideoSmart(chatId, res.videoUrl, '✅ تفضّل الفيديو', replyId); return; }

  // No video found → try sending images from the page (sites with photos).
  const media = await extractPageMedia(url);
  if (media.images.length) {
    try {
      const group = media.images.slice(0, 10).map((img, i) => ({ type: 'photo', media: img, ...(i === 0 ? { caption: '✅ صور من الصفحة' } : {}) }));
      await tgCall('sendMediaGroup', { chat_id: chatId, media: group });
    } catch {
      let sent = 0;
      for (const img of media.images.slice(0, 10)) { if (await sendPhotoSmart(chatId, img)) sent++; }
      if (sent === 0) { await sendMsg(chatId, res.message, undefined, replyId); }
    }
    return;
  }
  await sendMsg(chatId, res.message, undefined, replyId);
}


async function safeRpc(supabase: any, fn: string, params: any) {
  try { await supabase.rpc(fn, params); } catch (e) { console.error(`rpc ${fn} error:`, e); }
}

type SearchResult = {
  title: string;
  url: string;
  snippet: string;
};

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function stripHtml(value: string): string {
  return value.replace(/<[^>]+>/g, ' ');
}

function decodeHtmlEntities(value: string): string {
  return value
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&#x27;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .replace(/&#x2F;/g, '/');
}

function cleanText(value: string | undefined, maxLength = 180): string {
  const normalized = decodeHtmlEntities(stripHtml(value || '')).replace(/\s+/g, ' ').trim();
  if (!normalized) return '';
  return normalized.length > maxLength ? `${normalized.slice(0, maxLength - 1)}…` : normalized;
}

function decodeDuckDuckGoUrl(rawHref: string): string | null {
  const href = decodeHtmlEntities(rawHref).trim();
  const normalized = href.startsWith('//')
    ? `https:${href}`
    : href.startsWith('/')
      ? `https://duckduckgo.com${href}`
      : href;

  try {
    const url = new URL(normalized);
    const redirected = url.searchParams.get('uddg');
    return redirected ? decodeURIComponent(redirected) : normalized;
  } catch {
    return null;
  }
}

function formatSearchResults(items: SearchResult[]): string {
  if (items.length === 0) return 'لم يتم العثور على نتائج.';

  const output = items.slice(0, 5).map((item, index) => {
    const lines = [`${index + 1}. <b>${escapeHtml(item.title)}</b>`, `🔗 <a href="${escapeHtml(item.url)}">فتح النتيجة</a>`];
    if (item.snippet) lines.push(`📝 ${escapeHtml(item.snippet)}`);
    return lines.join('\n');
  }).join('\n\n');

  return output.length > 3800 ? `${output.slice(0, 3797)}...` : output;
}

async function duckSearch(query: string, options: { youtubeOnly?: boolean } = {}): Promise<SearchResult[]> {
  const searchQuery = options.youtubeOnly ? `site:youtube.com ${query}` : query;
  const res = await fetch(`https://duckduckgo.com/html/?q=${encodeURIComponent(searchQuery)}`, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (compatible; LovableBot/1.0)',
      'Accept-Language': 'ar,en-US;q=0.9,en;q=0.8',
    },
  });

  if (!res.ok) throw new Error(`DuckDuckGo search failed [${res.status}]`);

  const html = await res.text();
  const blocks = html.match(/<div class="result\b[\s\S]*?<div class="clear"><\/div>\s*<\/div>\s*<\/div>/g) || [];
  const items: SearchResult[] = [];
  const seen = new Set<string>();

  for (const block of blocks) {
    if (block.includes('result--ad')) continue;

    const titleMatch = block.match(/class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/);
    if (!titleMatch) continue;

    const url = decodeDuckDuckGoUrl(titleMatch[1]);
    if (!url || seen.has(url)) continue;

    if (options.youtubeOnly) {
      try {
        const hostname = new URL(url).hostname.replace(/^www\./, '');
        if (!(hostname.includes('youtube.com') || hostname === 'youtu.be')) continue;
      } catch {
        continue;
      }
    }

    const snippetMatch = block.match(/class="result__snippet"[^>]*>([\s\S]*?)<\/a>|<div class="result__snippet"[^>]*>([\s\S]*?)<\/div>/);
    const title = cleanText(titleMatch[2], 140);
    const snippet = cleanText(snippetMatch?.[1] || snippetMatch?.[2] || '', 180);

    if (!title) continue;

    seen.add(url);
    items.push({ title, url, snippet });
    if (items.length >= 5) break;
  }

  return items;
}

// ==================== AUTO-REPLIES ====================

const AUTO_REPLIES: Record<string, string> = {
  'السلام عليكم': 'وعليكم السلام ورحمة الله وبركاته 🤲',
  'سلام عليكم': 'وعليكم السلام ورحمة الله وبركاته 🤲',
  'السلام': 'وعليكم السلام ورحمة الله وبركاته 🤲',
  'مرحبا': 'أهلاً وسهلاً بك! 👋',
  'مرحباً': 'أهلاً وسهلاً بك! 👋',
  'اهلا': 'أهلاً بك! 👋',
  'أهلا': 'أهلاً بك! 👋',
  'هاي': 'أهلاً! 👋',
  'هلا': 'هلا والله! 👋',
  'صباح الخير': 'صباح النور والسرور ☀️',
  'مساء الخير': 'مساء النور والهناء 🌙',
  'تصبحون على خير': 'وأنت من أهل الخير 🌙',
  'شكرا': 'عفواً، في خدمتك دائماً ❤️',
  'شكراً': 'عفواً، في خدمتك دائماً ❤️',
};

function getAutoReply(text: string): string | null {
  const normalized = text.trim().replace(/[!?.،؟]+$/g, '').trim();
  for (const [trigger, reply] of Object.entries(AUTO_REPLIES)) {
    if (normalized === trigger || normalized.startsWith(trigger + ' ')) {
      return reply;
    }
  }
  return null;
}

// ==================== FEATURE 1: TAGALL ====================

async function tagAllMembers(supabase: any, chatId: number, callerUsername: string) {
  const { data: members } = await supabase.from('telegram_users').select('username, first_name, user_id').eq('chat_id', chatId).eq('is_banned', false);
  let totalCount = 0;
  try { const c = await tgCall('getChatMembersCount', { chat_id: chatId }); totalCount = c.result || 0; } catch {}

  if (!members || members.length === 0) {
    await sendMsg(chatId, '❌ لا يوجد أعضاء مسجلين بعد');
    return;
  }

  await sendMsg(chatId, `📢 <b>نداء عام من ${callerUsername}!</b>\n👥 يتم مناداة <b>${members.length}</b> عضو${totalCount > members.length ? ` من أصل ${totalCount}` : ''}...`);

  const chunks: string[][] = [];
  for (let i = 0; i < members.length; i += 5) {
    const chunk = members.slice(i, i + 5).map((m: any) => `<a href="tg://user?id=${m.user_id}">${m.first_name || m.username || m.user_id}</a>`);
    chunks.push(chunk);
  }

  for (const chunk of chunks) {
    await sendMsg(chatId, `📣 ${chunk.join(' | ')}`);
    await new Promise(r => setTimeout(r, 800));
  }
  await sendMsg(chatId, `✅ تم مناداة <b>${members.length}</b> عضو بنجاح!`);
}

// ==================== FEATURE 2: AI ASSISTANT "فادي" ====================

async function handleAI(supabase: any, chatId: number, userId: number, username: string, text: string, replyMsg: any, messageId: number, photo?: any) {
  const isUserAdmin = await isAdmin(chatId, userId);
  const isOwner = isDeveloper(userId);

  const { data: groupMembers } = await supabase.from('telegram_users').select('first_name, username, user_id, points, coins').eq('chat_id', chatId).limit(30);
  const { data: groupInfo } = await supabase.from('telegram_groups').select('title').eq('chat_id', chatId).single();

  // Conversation memory: last 6 messages for context
  const { data: recentMsgs } = await supabase.from('telegram_messages')
    .select('user_id, username, text').eq('chat_id', chatId)
    .not('text', 'is', null).order('created_at', { ascending: false }).limit(6);
  const conversationContext = (recentMsgs || []).reverse()
    .map((m: any) => `${m.username || m.user_id}: ${(m.text || '').slice(0, 150)}`).join('\n');

  let imageUrl: string | undefined;
  if (photo && photo.length > 0) {
    try {
      const fileId = photo[photo.length - 1].file_id;
      const fileData = await tgCall('getFile', { file_id: fileId });
      if (fileData.result?.file_path) {
        imageUrl = `https://connector-gateway.lovable.dev/telegram/file/${fileData.result.file_path}`;
      }
    } catch (e) { console.error('Photo error:', e); }
  }

  const systemPrompt = `أنت "فادي"، وكيل ذكاء اصطناعي متقدم لمجموعة تيليجرام. هويتك واحدة وقدراتك متعددة.
مهنتك: تفهم السياق بعمق (نص + صور)، تحلّل النية، تتخذ قرارات ذكية، وتنفّذ المهام الإدارية.

المستخدم: ${username} (ID:${userId}) | مشرف: ${isUserAdmin ? 'نعم' : 'لا'} | المطور: ${isOwner ? 'نعم' : 'لا'}
المجموعة: ${groupInfo?.title || 'مجموعة'} | أعضاء مسجّلون: ${(groupMembers || []).length}
${replyMsg ? `يردّ على: ${replyMsg.from?.first_name || 'مجهول'} (ID:${replyMsg.from?.id}) - "${(replyMsg.text || '(وسائط)').slice(0, 200)}"` : ''}

آخر رسائل في المحادثة (للسياق):
${conversationContext || '(لا يوجد)'}

قواعد الرد:
- نبرتك جادة، ودودة، مهنية، مختصرة (2-4 أسطر) — بدون مزاح إلا لو طُلب.
- لا تكشف رسائل خطأ تقنية. لو فشل شيء، اشرح بشرياً واقترح بديل.

لو في صورة:
- لا تكتفِ بالوصف السطحي. حلّل بعمق:
  • السياق العام (إيه اللي بيحصل ولماذا؟)
  • العناصر (أشخاص، أشياء، نصوص، مشاعر، بيئة)
  • نوع الصورة (ميم، إعلان، لقطة شاشة، صورة شخصية، تصميم، خطأ برمجي...)
  • لو فيها نص: استخرجه وحلّله
  • لو غامضة: اطلب توضيح بذكاء
- جاوب على سؤال المستخدم بدقة بناءً على الصورة.

أوامر إدارية بلغة طبيعية (احظر/اطرد/اكتم/حذّر/رقّي):
- لو المستخدم مشرف أو المطور وطلب إجراء على شخص (بالرد عليه أو بذكر ID)، أضف في نهاية ردك بالضبط:
  [ACTION:{"type":"ban|kick|mute|unmute|warn|promote|demote","target_user_id":<ID>}]

🌐 المتصفح التفاعلي (كروم):
- لو المستخدم طلب يفتح/يصوّر/يشوف موقع، أو قال "صوّر/لقطة شاشة/افتح/ادخل/شوف موقع/screenshot"، استخرج اسم الموقع وحوّله لرابط كامل، ثم أضف في نهاية ردك بالضبط:
  [BROWSER:{"action":"screenshot|open","url":"https://...","fullpage":true|false,"mobile":true|false}]
  • استخدم "screenshot" لو طلب صورة فقط، و"open" لو عايز يتصفح/يلخّص محتوى الموقع كمان.
  • fullpage=true لو قال "الصفحة كاملة"، mobile=true لو قال "موبايل/جوال".
  • مثال: «فادي صوّرلي جوجل» → [BROWSER:{"action":"screenshot","url":"https://google.com","fullpage":false,"mobile":false}]
  • مثال: «فادي افتح موقع ويكيبيديا ولخصه» → [BROWSER:{"action":"open","url":"https://wikipedia.org","fullpage":false,"mobile":false}]
- لا تُنشئ JSON إلا للإجراءات الفعلية.

🎨 توليد الصور بالذكاء الاصطناعي:
- لو المستخدم طلب "ارسم/صمّم/ولّد/اعملي صورة/generate image/draw"، استخرج وصف الصورة بالإنجليزية (أدق للنموذج) وأضف في نهاية ردك بالضبط:
  [IMAGE:{"prompt":"detailed english description"}]
  • مثال: «فادي ارسملي قطة فضائية» → [IMAGE:{"prompt":"a cute astronaut cat floating in space, digital art, highly detailed"}]
  • لا تستخدم هذا إلا لو طلب رسم/توليد صورة جديدة (ليس تحليل صورة موجودة).

📥 تنزيل الفيديوهات والصور:
- لو المستخدم بعت رابط فيديو/صور (تيك توك، يوتيوب، إنستجرام، أو أي موقع فيه فيديو أو صور) وطلب تنزيله/تحميله/"نزّلهولي"، أضف في نهاية ردك بالضبط:
  [DOWNLOAD:{"url":"https://..."}]
  • يدعم فيديوهات تيك توك وصوره (سلايد شو)، يوتيوب، وأي رابط مباشر لفيديو أو صورة.
  • مثال: «فادي نزّلي الفيديو ده https://...» → [DOWNLOAD:{"url":"https://..."}]
  • استخدم الرابط الكامل الذي أرسله المستخدم كما هو.`;

  try {
    const userPrompt = text || (imageUrl ? 'حلّل هذه الصورة بعمق وأخبرني ما الذي تراه ولماذا.' : '');
    if (!userPrompt && !imageUrl) return;

    let reply: string;
    try {
      reply = await callAI(userPrompt, systemPrompt, imageUrl);
    } catch (e) {
      // Fallback to a different model on persistent failure
      try { reply = await callAI(userPrompt, systemPrompt, imageUrl, 'google/gemini-2.5-flash-lite'); }
      catch (e2) { await sendMsg(chatId, humanError('الرد الذكي', e2), undefined, messageId); return; }
    }
    if (!reply) return;

    let cleanReply = reply;
    const actionMatch = reply.match(/\[ACTION:(\{.*?\})\]/);
    if (actionMatch) {
      cleanReply = reply.replace(/\[ACTION:\{.*?\}\]/, '').trim();
      try {
        const action = JSON.parse(actionMatch[1]);
        const targetId = action.target_user_id || replyMsg?.from?.id;
        if (targetId && (isUserAdmin || isOwner)) {
          const tgtName = replyMsg?.from?.username || replyMsg?.from?.first_name || String(targetId);
          switch (action.type) {
            case 'ban': await tgCall('banChatMember', { chat_id: chatId, user_id: targetId }); await supabase.from('telegram_users').update({ is_banned: true }).eq('user_id', targetId).eq('chat_id', chatId); await logAction(supabase, chatId, userId, username, targetId, tgtName, 'ban', 'عبر فادي'); break;
            case 'kick': await tgCall('banChatMember', { chat_id: chatId, user_id: targetId }); await tgCall('unbanChatMember', { chat_id: chatId, user_id: targetId }); await logAction(supabase, chatId, userId, username, targetId, tgtName, 'kick', 'عبر فادي'); break;
            case 'mute': await tgCall('restrictChatMember', { chat_id: chatId, user_id: targetId, permissions: { can_send_messages: false, can_send_media_messages: false, can_send_other_messages: false } }); await supabase.from('telegram_users').update({ is_muted: true }).eq('user_id', targetId).eq('chat_id', chatId); await logAction(supabase, chatId, userId, username, targetId, tgtName, 'mute', 'عبر فادي'); break;
            case 'unmute': await tgCall('restrictChatMember', { chat_id: chatId, user_id: targetId, permissions: { can_send_messages: true, can_send_media_messages: true, can_send_other_messages: true, can_add_web_page_previews: true } }); await supabase.from('telegram_users').update({ is_muted: false }).eq('user_id', targetId).eq('chat_id', chatId); break;
            case 'warn': { const { data: u } = await supabase.from('telegram_users').select('warnings').eq('user_id', targetId).eq('chat_id', chatId).single(); const nw = (u?.warnings || 0) + 1; await supabase.from('telegram_users').update({ warnings: nw, total_warns: nw }).eq('user_id', targetId).eq('chat_id', chatId); await logAction(supabase, chatId, userId, username, targetId, tgtName, 'warn', `${nw}/3 عبر فادي`); if (nw >= 3) { await tgCall('banChatMember', { chat_id: chatId, user_id: targetId }); await tgCall('unbanChatMember', { chat_id: chatId, user_id: targetId }); cleanReply += '\n⚠️ وصل 3 تحذيرات وتم طرده!'; } break; }
            case 'promote': await tgCall('promoteChatMember', { chat_id: chatId, user_id: targetId, can_delete_messages: true, can_restrict_members: true, can_pin_messages: true, can_invite_users: true }); await logAction(supabase, chatId, userId, username, targetId, tgtName, 'promote', 'عبر فادي'); break;
            case 'demote': await tgCall('promoteChatMember', { chat_id: chatId, user_id: targetId, can_delete_messages: false, can_restrict_members: false, can_pin_messages: false }); await logAction(supabase, chatId, userId, username, targetId, tgtName, 'demote', 'عبر فادي'); break;
          }
        }
      } catch (e) { console.error('AI action error:', e); }
    }

    // 🎨 AI image generation action
    const imageGenMatch = reply.match(/\[IMAGE:(\{[\s\S]*?\})\]/);
    if (imageGenMatch) {
      cleanReply = cleanReply.replace(/\[IMAGE:\{[\s\S]*?\}\]/, '').trim();
      if (cleanReply) await sendMsg(chatId, `🤖 ${cleanReply}`, undefined, messageId);
      try {
        const im = JSON.parse(imageGenMatch[1]);
        if (im.prompt) await sendAIImage(chatId, im.prompt, messageId);
      } catch (e) {
        console.error('AI image action error:', e);
        await sendMsg(chatId, '❌ معرفتش أحدد وصف الصورة المطلوبة.');
      }
      return;
    }

    // 🌐 Interactive browser action (screenshot / open site)
    const browserMatch = reply.match(/\[BROWSER:(\{[\s\S]*?\})\]/);
    if (browserMatch) {
      cleanReply = cleanReply.replace(/\[BROWSER:\{[\s\S]*?\}\]/, '').trim();
      if (cleanReply) await sendMsg(chatId, `🤖 ${cleanReply}`, undefined, messageId);
      try {
        const b = JSON.parse(browserMatch[1]);
        const opts = { fullpage: !!b.fullpage, mobile: !!b.mobile };
        if (b.action === 'open') await openSite(chatId, b.url, opts);
        else await sendScreenshot(chatId, b.url, opts);
      } catch (e) {
        console.error('AI browser action error:', e);
        await sendMsg(chatId, '❌ معرفتش أحدد الموقع المطلوب. ابعت الرابط بصيغة واضحة.');
      }
      return;
    }

    // 📥 Download action (videos / images from any site)
    const downloadMatch = reply.match(/\[DOWNLOAD:(\{[\s\S]*?\})\]/);
    if (downloadMatch) {
      cleanReply = cleanReply.replace(/\[DOWNLOAD:\{[\s\S]*?\}\]/, '').trim();
      if (cleanReply) await sendMsg(chatId, `🤖 ${cleanReply}`, undefined, messageId);
      try {
        const d = JSON.parse(downloadMatch[1]);
        if (d.url) await handleDownload(chatId, normalizeUrl(d.url), supabase, messageId);
        else await sendMsg(chatId, '❌ ابعت رابط الفيديو أو الصور المطلوب تنزيله.');
      } catch (e) {
        console.error('AI download action error:', e);
        await sendMsg(chatId, '❌ معرفتش أحدد الرابط المطلوب تنزيله.');
      }
      return;
    }

    if (cleanReply) await sendMsg(chatId, `🤖 ${cleanReply}`, undefined, messageId);
  } catch (e) {
    console.error('AI error:', e);
    await sendMsg(chatId, humanError('الرد الذكي', e), undefined, messageId);
  }
}

// ==================== FEATURE 3: TOXICITY FILTER ====================

async function checkToxicity(text: string): Promise<{ toxic: boolean; reason: string }> {
  try {
    const result = await callAI(text, 'أنت فلتر محتوى. حلل الرسالة التالية. إذا كانت تحتوي على سب، شتم، تحرش، عنصرية، أو محتوى ضار، أجب بـ TOXIC:السبب. وإلا أجب بـ SAFE. فقط كلمة واحدة.');
    if (result.startsWith('TOXIC')) return { toxic: true, reason: result.replace('TOXIC:', '').trim() };
    return { toxic: false, reason: '' };
  } catch { return { toxic: false, reason: '' }; }
}

// ==================== FEATURE 4: RAID DETECTION (DB-BASED) ====================

async function detectRaid(supabase: any, chatId: number, userId: number): Promise<boolean> {
  // Record this join
  await supabase.from('telegram_raid_joins').insert({ chat_id: chatId, user_id: userId });
  // Cleanup old joins
  await supabase.rpc('cleanup_old_raid_joins').catch(() => {});
  // Count recent joins in last 60 seconds
  const cutoff = new Date(Date.now() - 60000).toISOString();
  const { count } = await supabase.from('telegram_raid_joins').select('id', { count: 'exact', head: true }).eq('chat_id', chatId).gte('joined_at', cutoff);
  return (count || 0) >= 10;
}

// ==================== FEATURE 5: ANTI-FLOOD (RATE LIMITING) ====================

const floodTracker: Record<string, number[]> = {};

function detectFlood(userId: number, chatId: number, maxMsgs: number, intervalSec: number): boolean {
  const key = `${chatId}_${userId}`;
  const now = Date.now();
  if (!floodTracker[key]) floodTracker[key] = [];
  floodTracker[key].push(now);
  floodTracker[key] = floodTracker[key].filter(t => now - t < intervalSec * 1000);
  return floodTracker[key].length > maxMsgs;
}

// ==================== FEATURE 6: BLACKLIST WORDS ====================

function containsBlacklistedWord(text: string, blacklist: string[]): string | null {
  if (!blacklist || blacklist.length === 0) return null;
  const lower = text.toLowerCase();
  for (const word of blacklist) {
    if (word && lower.includes(word.toLowerCase())) return word;
  }
  return null;
}

// ==================== FEATURE 7: FORWARD SPAM DETECTION ====================

const forwardTracker: Record<string, number[]> = {};

function detectForwardSpam(userId: number, chatId: number): boolean {
  const key = `fwd_${chatId}_${userId}`;
  const now = Date.now();
  if (!forwardTracker[key]) forwardTracker[key] = [];
  forwardTracker[key].push(now);
  forwardTracker[key] = forwardTracker[key].filter(t => now - t < 30000);
  return forwardTracker[key].length >= 4; // 4 forwards in 30 seconds
}

// ==================== ENTERTAINMENT DATA ====================

const jokes = [
  "واحد راح للدكتور قاله عندي مشكلة في عيني.. قاله إيه هي؟ قاله بشوف الناس صغيرة.. قاله طب ابعد عن البلكونة 😂",
  "واحد سأل صاحبه: ليش ما تاكل سمك؟ قاله: لأنه ما سوالي شي 😂",
  "مدرس سأل طالب: وين ولدت؟ قال: في المستشفى. قال: ليش كنت مريض؟ 😂",
];

const quizzes = [
  { q: "ما هي عاصمة فرنسا؟", options: ["لندن", "باريس", "برلين", "مدريد"], answer: 1 },
  { q: "كم عدد قارات العالم؟", options: ["5", "6", "7", "8"], answer: 2 },
  { q: "ما هو أكبر كوكب في المجموعة الشمسية؟", options: ["زحل", "المشتري", "أورانوس", "نبتون"], answer: 1 },
  { q: "في أي عام هبط الإنسان على القمر؟", options: ["1965", "1969", "1971", "1975"], answer: 1 },
  { q: "ما هي أطول نهر في العالم؟", options: ["النيل", "الأمازون", "المسيسيبي", "اليانغتسي"], answer: 0 },
  { q: "ما هي أكبر دولة عربية مساحة؟", options: ["مصر", "السعودية", "الجزائر", "السودان"], answer: 2 },
  { q: "كم عدد أسنان الإنسان البالغ؟", options: ["28", "30", "32", "34"], answer: 2 },
  { q: "ما هو أسرع حيوان في العالم؟", options: ["الأسد", "الفهد", "النمر", "الحصان"], answer: 1 },
];

const truths = ["ما هو أكثر شيء محرج حصل لك؟", "ما هو سرك الذي لا يعرفه أحد؟", "من هو الشخص الذي تحبه أكثر في هذه المجموعة؟", "ما هو أغرب حلم حلمت به؟", "ما هو الشيء الذي تخاف منه؟"];
const dares = ["أرسل رسالة حب لآخر شخص كلمته 😂", "غير صورتك الشخصية لمدة ساعة", "أرسل رسالة صوتية وأنت تغني", "اكتب اسمك بالمقلوب واستخدمه لمدة يوم"];
const hackMessages = ["⚡ جاري الاتصال بالسيرفرات...", "🔍 البحث عن الثغرات...", "💻 اختراق جدار الحماية...", "📡 الوصول لقاعدة البيانات...", "📸 تحميل الصور والملفات...", "🔓 فك تشفير كلمات المرور...", "🎯 تحليل البيانات الشخصية...", "☠️ زرع فيروس التجسس..."];

const trustNames = ['🆕 جديد', '🌱 مبتدئ', '🌿 نشط', '🌳 موثوق', '⭐ خبير', '🏆 أسطوري'];

// ==================== SEARCH FUNCTIONS ====================

async function searchBooks(query: string): Promise<string> {
  try {
    const res = await fetch(`https://www.googleapis.com/books/v1/volumes?q=${encodeURIComponent(query)}&maxResults=5&langRestrict=ar`);
    if (!res.ok) {
      const res2 = await fetch(`https://www.googleapis.com/books/v1/volumes?q=${encodeURIComponent(query)}&maxResults=5`);
      if (!res2.ok) return '❌ فشل الاتصال بمحرك البحث.';
      const data2 = await res2.json();
      return formatBooks(data2);
    }
    const data = await res.json();
    if (!data.items || data.items.length === 0) {
      const res2 = await fetch(`https://www.googleapis.com/books/v1/volumes?q=${encodeURIComponent(query)}&maxResults=5`);
      const data2 = await res2.json();
      return formatBooks(data2);
    }
    return formatBooks(data);
  } catch (error) {
    console.error('Book search error:', error);
    return '❌ فشل البحث. حاول لاحقاً.';
  }
}

function formatBooks(data: any): string {
  if (!data.items || data.items.length === 0) return 'لم يتم العثور على نتائج.';
  const output = data.items.slice(0, 5).map((item: any, i: number) => {
    const info = item.volumeInfo || {};
    const title = cleanText(info.title || 'بدون عنوان', 120);
    const authors = cleanText(info.authors?.join('، ') || 'غير معروف', 100);
    const desc = cleanText(info.description || info.subtitle || '', 150);
    const link = info.infoLink || info.previewLink || '';
    const pdf = info.accessInfo?.pdf?.isAvailable || info.accessInfo?.pdf?.acsTokenLink;

    const lines = [`${i + 1}. <b>${escapeHtml(title)}</b>`, `✍️ ${escapeHtml(authors)}`];
    if (desc) lines.push(`📝 ${escapeHtml(desc)}`);
    if (link) lines.push(`🔗 <a href="${escapeHtml(link)}">رابط الكتاب</a>`);
    if (pdf) lines.push('📥 تتوفر معاينة أو نسخة قابلة للتنزيل');
    return lines.join('\n');
  }).join('\n\n');

  return output.length > 3800 ? `${output.slice(0, 3797)}...` : output;
}

async function searchYouTube(query: string, supabase?: any): Promise<string> {
  // 1) Real YouTube search via InnerTube using account cookies
  try {
    const cookies = supabase ? await getYouTubeCookies(supabase) : null;
    const results = await ytInnertubeSearch(query, cookies);
    if (results.length > 0) return formatSearchResults(results);
  } catch (error) {
    console.error('InnerTube YouTube search error:', error);
  }
  // 2) Fallback to DuckDuckGo scraping
  try {
    const results = await duckSearch(query, { youtubeOnly: true });
    return formatSearchResults(results);
  } catch (error) {
    console.error('YouTube search error:', error);
    return '❌ فشل البحث. حاول لاحقاً.';
  }
}


async function searchWeb(query: string): Promise<string> {
  try {
    const results = await duckSearch(query);
    return formatSearchResults(results);
  } catch (error) {
    console.error('Web search error:', error);
    return '❌ فشل البحث. حاول لاحقاً.';
  }
}

// ==================== IMAGE SEARCH ====================

async function searchImages(query: string, limit = 6): Promise<string[]> {
  try {
    const tokenRes = await fetch(`https://duckduckgo.com/?q=${encodeURIComponent(query)}&iax=images&ia=images`, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' },
    });
    const html = await tokenRes.text();
    const vqdMatch = html.match(/vqd=["']?([\d-]+)["']?/);
    if (!vqdMatch) return [];
    const vqd = vqdMatch[1];
    const res = await fetch(`https://duckduckgo.com/i.js?l=us-en&o=json&q=${encodeURIComponent(query)}&vqd=${vqd}&f=,,,&p=1`, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)', 'Referer': 'https://duckduckgo.com/' },
    });
    if (!res.ok) return [];
    const data = await res.json();
    return (data.results || []).map((r: any) => r.image).filter(Boolean).slice(0, limit);
  } catch (e) {
    console.error('Image search error:', e);
    return [];
  }
}

// ==================== FILE SEARCH ====================

async function searchFiles(query: string, fileType: string): Promise<string> {
  try {
    const results = await duckSearch(`${query} filetype:${fileType}`);
    if (results.length === 0) return `لم يتم العثور على ملفات ${fileType.toUpperCase()}.`;
    return results.map((item, i) => {
      const lines = [`${i + 1}. <b>${escapeHtml(item.title)}</b>`, `📂 <a href="${escapeHtml(item.url)}">تحميل (${fileType.toUpperCase()})</a>`];
      if (item.snippet) lines.push(`📝 ${escapeHtml(item.snippet)}`);
      return lines.join('\n');
    }).join('\n\n');
  } catch (e) {
    console.error('File search error:', e);
    return '❌ فشل البحث عن الملفات.';
  }
}

// ==================== DIRECT FILE DOWNLOAD ====================

async function fetchFileInfo(url: string): Promise<{ size: number; name: string; contentType: string }> {
  let size = 0;
  let contentType = 'application/octet-stream';
  try {
    const head = await fetch(url, { method: 'HEAD', headers: { 'User-Agent': 'Mozilla/5.0' } });
    size = parseInt(head.headers.get('content-length') || '0');
    contentType = head.headers.get('content-type') || contentType;
  } catch { /* ignore */ }
  let name = 'file';
  try {
    const u = new URL(url);
    const last = u.pathname.split('/').filter(Boolean).pop();
    if (last) name = decodeURIComponent(last);
  } catch { /* ignore */ }
  return { size, name, contentType };
}

// ==================== INTERACTIVE BROWSE ====================

async function browsePage(url: string): Promise<string> {
  try {
    const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)', 'Accept-Language': 'ar,en;q=0.9' } });
    if (!res.ok) return `❌ تعذّر فتح الصفحة [${res.status}].`;
    const html = await res.text();
    const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
    const title = cleanText(titleMatch?.[1] || url, 120);
    let body = html
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<nav[\s\S]*?<\/nav>/gi, ' ')
      .replace(/<footer[\s\S]*?<\/footer>/gi, ' ');
    const text = decodeHtmlEntities(stripHtml(body)).replace(/\s+/g, ' ').trim().slice(0, 6000);
    const links = [...html.matchAll(/<a[^>]+href="(https?:\/\/[^"#]+)"[^>]*>([\s\S]*?)<\/a>/gi)]
      .map(m => ({ url: m[1], label: cleanText(m[2], 50) }))
      .filter(l => l.label && l.label.length > 3)
      .slice(0, 6);
    const summary = await callAI(
      `لخّص محتوى هذه الصفحة بالعربية في نقاط مختصرة وواضحة:\n\nالعنوان: ${title}\n\nالمحتوى:\n${text}`,
      'أنت مساعد يلخّص صفحات الويب بدقة وإيجاز باللغة العربية.',
    );
    let out = `🌐 <b>${escapeHtml(title)}</b>\n🔗 ${escapeHtml(url)}\n━━━━━━━━━━━━━━\n${escapeHtml(summary)}`;
    if (links.length) {
      out += `\n\n🔗 <b>روابط داخل الصفحة:</b>\n${links.map((l, i) => `${i + 1}. <a href="${escapeHtml(l.url)}">${escapeHtml(l.label)}</a>`).join('\n')}`;
    }
    return out.length > 3900 ? `${out.slice(0, 3897)}...` : out;
  } catch (e) {
    console.error('Browse error:', e);
    return '❌ فشل تصفح الصفحة.';
  }
}

// ==================== INTERACTIVE CHROME BROWSER (screenshots) ====================

function normalizeUrl(input: string): string {
  let u = (input || '').trim().replace(/^[<"']|[>"']$/g, '');
  if (!u) return '';
  if (!/^https?:\/\//i.test(u)) u = 'https://' + u;
  return u;
}

// Multiple real-Chrome screenshot providers; tried in order until one returns a valid image.
function buildScreenshotUrls(url: string, opts: { fullpage?: boolean; mobile?: boolean; wait?: number } = {}): string[] {
  const width = opts.mobile ? 430 : 1280;
  const enc = encodeURIComponent(url);
  const urls: string[] = [];
  // thum.io (headless Chrome)
  const thum = ['https://image.thum.io/get', 'width', String(width)];
  if (opts.mobile) thum.push('viewportwidth', '430');
  if (opts.fullpage) thum.push('fullpage');
  thum.push('wait', String(opts.wait ?? 3), 'noanimate');
  urls.push(thum.join('/') + '/' + url);
  // WordPress mShots (free headless Chrome)
  urls.push(`https://s.wordpress.com/mshots/v1/${enc}?w=${width}${opts.fullpage ? '' : '&h=' + (opts.mobile ? 900 : 720)}`);
  // Microlink screenshot (returns image bytes via embed)
  urls.push(`https://api.microlink.io/?url=${enc}&screenshot=true&meta=false&embed=screenshot.url&viewport.width=${width}${opts.fullpage ? '&screenshot.fullPage=true' : ''}`);
  return urls;
}

// Fetches a rendered screenshot as bytes from the first working provider.
async function captureScreenshot(url: string, opts: { fullpage?: boolean; mobile?: boolean } = {}): Promise<{ bytes: Uint8Array; mime: string } | null> {
  for (const shotUrl of buildScreenshotUrls(url, opts)) {
    // mShots returns a placeholder until the render is ready; retry a couple of times.
    const attempts = shotUrl.includes('mshots') ? 3 : 1;
    for (let i = 0; i < attempts; i++) {
      if (i > 0) await new Promise(r => setTimeout(r, 2500));
      const got = await fetchBytes(shotUrl, 9 * 1024 * 1024, { 'Referer': url });
      if (got && /image\//i.test(got.mime) && got.bytes.byteLength > 3000) return got;
    }
  }
  return null;
}

// Captures a website and sends the screenshot to Telegram. Returns true on success.
async function sendScreenshot(chatId: number, rawUrl: string, opts: { fullpage?: boolean; mobile?: boolean } = {}, extraCaption = ''): Promise<boolean> {
  const url = normalizeUrl(rawUrl);
  if (!url || !/^https?:\/\/.+\..+/i.test(url)) {
    await sendMsg(chatId, '🌐 ابعت رابط صحيح للموقع اللي عايز تصوّره.');
    return false;
  }
  try { await tgCall('sendChatAction', { chat_id: chatId, action: 'upload_photo' }); } catch { /* ignore */ }
  const caption = `📸 <b>لقطة شاشة</b> ${opts.mobile ? '📱 (جوال)' : '🖥️ (سطح مكتب)'}${opts.fullpage ? ' • صفحة كاملة' : ''}\n🔗 ${escapeHtml(url)}${extraCaption ? `\n${extraCaption}` : ''}`;
  const shot = await captureScreenshot(url, opts);
  if (!shot) {
    await sendMsg(chatId, `❌ تعذّر تصوير الموقع دلوقتي. جرّب تاني أو غيّر الرابط.\n🔗 ${escapeHtml(url)}`);
    return false;
  }
  try {
    // Full-page shots can be tall → send as document to avoid Telegram photo ratio limits.
    if (opts.fullpage) {
      await tgUpload('sendDocument', { chat_id: chatId, caption, parse_mode: 'HTML' },
        [{ field: 'document', bytes: shot.bytes, filename: 'screenshot.png', mime: shot.mime || 'image/png' }]);
    } else {
      await tgUpload('sendPhoto', { chat_id: chatId, caption, parse_mode: 'HTML' },
        [{ field: 'photo', bytes: shot.bytes, filename: 'screenshot.png', mime: shot.mime || 'image/png' }]);
    }
    return true;
  } catch (e) {
    console.error('Screenshot send error:', e);
    try {
      await tgUpload('sendDocument', { chat_id: chatId, caption, parse_mode: 'HTML' },
        [{ field: 'document', bytes: shot.bytes, filename: 'screenshot.png', mime: shot.mime || 'image/png' }]);
      return true;
    } catch {
      await sendMsg(chatId, `❌ تعذّر إرسال لقطة الموقع دلوقتي. جرّب تاني.\n🔗 ${escapeHtml(url)}`);
      return false;
    }
  }
}

// Full interactive open: screenshot + content summary + clickable links in one shot.
async function openSite(chatId: number, rawUrl: string, opts: { fullpage?: boolean; mobile?: boolean } = {}) {
  const url = normalizeUrl(rawUrl);
  await sendScreenshot(chatId, url, opts);
  try {
    const summary = await browsePage(url);
    await sendMsg(chatId, summary, undefined);
  } catch { /* screenshot already sent */ }
}

// ==================== WEATHER ====================

const WEATHER_CODES: Record<number, string> = {
  0: '☀️ صحو', 1: '🌤️ غائم جزئياً', 2: '⛅ غائم جزئياً', 3: '☁️ غائم',
  45: '🌫️ ضباب', 48: '🌫️ ضباب', 51: '🌦️ رذاذ خفيف', 53: '🌦️ رذاذ', 55: '🌦️ رذاذ كثيف',
  61: '🌧️ مطر خفيف', 63: '🌧️ مطر', 65: '🌧️ مطر غزير', 71: '🌨️ ثلج خفيف', 73: '🌨️ ثلج', 75: '🌨️ ثلج كثيف',
  80: '🌦️ زخات مطر', 81: '🌧️ زخات مطر', 82: '⛈️ زخات غزيرة', 95: '⛈️ عاصفة رعدية', 96: '⛈️ عاصفة برَد', 99: '⛈️ عاصفة برَد',
};

async function getWeather(city: string): Promise<string> {
  try {
    const geo = await fetch(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(city)}&count=1&language=ar`);
    const gd = await geo.json();
    if (!gd.results?.length) return '❌ لم أجد هذه المدينة. تأكد من الاسم.';
    const { latitude, longitude, name, country } = gd.results[0];
    const w = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}&current=temperature_2m,relative_humidity_2m,apparent_temperature,wind_speed_10m,weather_code`);
    const wd = await w.json();
    const c = wd.current;
    const desc = WEATHER_CODES[c.weather_code] || '🌡️';
    return `🌤️ <b>الطقس في ${escapeHtml(name)}، ${escapeHtml(country || '')}</b>\n━━━━━━━━━━━━━━\n${desc}\n🌡️ الحرارة: <b>${c.temperature_2m}°C</b> (محسوسة ${c.apparent_temperature}°C)\n💧 الرطوبة: ${c.relative_humidity_2m}%\n💨 الرياح: ${c.wind_speed_10m} كم/س`;
  } catch (e) {
    console.error('Weather error:', e);
    return '❌ فشل جلب حالة الطقس.';
  }
}

// ==================== CRYPTO ====================

const CRYPTO_ALIASES: Record<string, string> = {
  btc: 'bitcoin', eth: 'ethereum', bnb: 'binancecoin', sol: 'solana', xrp: 'ripple',
  ada: 'cardano', doge: 'dogecoin', trx: 'tron', ton: 'the-open-network', usdt: 'tether',
};

async function getCrypto(coin: string): Promise<string> {
  try {
    const id = CRYPTO_ALIASES[coin.toLowerCase()] || coin.toLowerCase();
    const res = await fetch(`https://api.coingecko.com/api/v3/simple/price?ids=${encodeURIComponent(id)}&vs_currencies=usd&include_24hr_change=true&include_market_cap=true`);
    const data = await res.json();
    if (!data[id]) return '❌ عملة غير معروفة. جرّب: btc, eth, sol, bnb, ...';
    const p = data[id];
    const ch = p.usd_24h_change || 0;
    return `💰 <b>${coin.toUpperCase()}</b>\n━━━━━━━━━━━━━━\n💵 السعر: <b>$${p.usd.toLocaleString()}</b>\n${ch >= 0 ? '📈' : '📉'} التغير 24س: <b>${ch.toFixed(2)}%</b>\n🏦 القيمة السوقية: $${Math.round(p.usd_market_cap || 0).toLocaleString()}`;
  } catch (e) {
    console.error('Crypto error:', e);
    return '❌ فشل جلب سعر العملة.';
  }
}

// ==================== TRANSLATE ====================

async function translateText(target: string, text: string): Promise<string> {
  try {
    const out = await callAI(
      `ترجم النص التالي إلى "${target}". أعد الترجمة فقط دون أي شرح أو إضافات:\n\n${text}`,
      'أنت مترجم محترف دقيق. ترجم النص المطلوب إلى اللغة المطلوبة بدقة وطبيعية.',
    );
    return out.trim();
  } catch {
    return '❌ فشل الترجمة.';
  }
}

// ==================== RSS ====================

async function getRss(url: string): Promise<string> {
  try {
    const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
    if (!res.ok) return `❌ تعذّر جلب التغذية [${res.status}].`;
    const xml = await res.text();
    const feedTitle = cleanText(xml.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || 'RSS', 80);
    const blocks = [...xml.matchAll(/<(?:item|entry)[\s\S]*?<\/(?:item|entry)>/gi)].slice(0, 6);
    if (blocks.length === 0) return '❌ لا توجد عناصر في هذه التغذية.';
    const items = blocks.map((b, i) => {
      const block = b[0];
      const title = cleanText(block.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || 'بدون عنوان', 120);
      let link = block.match(/<link[^>]*>([\s\S]*?)<\/link>/i)?.[1]?.trim() || block.match(/<link[^>]+href="([^"]+)"/i)?.[1] || '';
      link = decodeHtmlEntities(link).trim();
      const lines = [`${i + 1}. <b>${escapeHtml(title)}</b>`];
      if (link) lines.push(`🔗 <a href="${escapeHtml(link)}">قراءة</a>`);
      return lines.join('\n');
    }).join('\n\n');
    return `📰 <b>${escapeHtml(feedTitle)}</b>\n━━━━━━━━━━━━━━\n${items}`;
  } catch (e) {
    console.error('RSS error:', e);
    return '❌ فشل قراءة التغذية.';
  }
}

// ==================== MAIN COMMAND HANDLER ====================

async function handleCommand(supabase: any, update: any) {
  const msg = update.message;
  if (!msg) return;

  const chatId = msg.chat.id;
  const userId = msg.from.id;
  const username = msg.from.username || msg.from.first_name || '';
  const text = (msg.text || '').trim();
  const replyMsg = msg.reply_to_message;
  const targetUser = replyMsg?.from;

  if (msg.chat.type !== 'private') {
    await ensureGroup(supabase, chatId, msg.chat.title);
    await ensureUser(supabase, userId, chatId, msg.from.username, msg.from.first_name, msg.from.last_name);
  }

  // ==================== NEW MEMBER HANDLING ====================
  if (msg.new_chat_members) {
    const { data: group } = await supabase.from('telegram_groups').select('*').eq('chat_id', chatId).single();
    const groupTitle = group?.title || msg.chat.title || 'مجموعة';

    if (group?.raid_protection) {
      if (await detectRaid(supabase, chatId, member?.id || 0)) {
        await sendMsg(chatId, '🚨 <b>تنبيه غارة!</b>\n\nتم رصد انضمام جماعي مشبوه. يتم تفعيل الحماية التلقائية...');
        await notifyDeveloper(`🚨 <b>غارة محتملة!</b>\nالمجموعة: ${groupTitle}\nعدد الانضمامات: 10+ في دقيقة`);
        // Auto-ban the newcomers in a raid
        for (const member of msg.new_chat_members) {
          try { await tgCall('banChatMember', { chat_id: chatId, user_id: member.id }); } catch {}
        }
        return;
      }
    }

    for (const member of msg.new_chat_members) {
      const name = member.first_name || member.username || 'عضو جديد';
      await ensureUser(supabase, member.id, chatId, member.username, member.first_name, member.last_name);

      // Restrict new accounts (less than X days old)
      if (group?.restrict_new_accounts && member.id) {
        // Telegram user IDs are sequential - newer accounts have higher IDs
        // We use a heuristic: if the account ID suggests it was created recently
        // Better approach: check if they have no prior activity
        const { data: existingUser } = await supabase.from('telegram_users').select('created_at').eq('user_id', member.id).limit(1).single();
        if (!existingUser) {
          // First time seeing this user anywhere - restrict them
          await tgCall('restrictChatMember', { 
            chat_id: chatId, user_id: member.id, 
            permissions: { can_send_messages: true, can_send_media_messages: false, can_send_other_messages: false, can_add_web_page_previews: false },
            until_date: Math.floor(Date.now() / 1000) + (group.new_account_days || 7) * 86400
          });
          await sendMsg(chatId, `🔒 <b>${name}</b> حساب جديد - تم تقييده مؤقتاً (نص فقط لمدة ${group.new_account_days || 7} أيام)`);
        }
      }

      if (group?.captcha_enabled) {
        const num1 = Math.floor(Math.random() * 10) + 1;
        const num2 = Math.floor(Math.random() * 10) + 1;
        const answer = num1 + num2;
        // Shuffle answers randomly
        const options = [answer - 1, answer, answer + 1].sort(() => Math.random() - 0.5);
        await tgCall('restrictChatMember', { chat_id: chatId, user_id: member.id, permissions: { can_send_messages: false } });
        // Track captcha for timeout
        await supabase.from('telegram_captcha_pending').upsert({ chat_id: chatId, user_id: member.id }, { onConflict: 'chat_id,user_id' });
        await sendMsg(chatId, `🔒 <b>تحقق أمني لـ ${name}</b>\n\nأجب على السؤال خلال <b>دقيقتين</b> وإلا ستُطرد:\n❓ كم يساوي <b>${num1} + ${num2}</b>؟`, {
          inline_keyboard: [
            options.map(o => ({ text: `${o}`, callback_data: `captcha_${member.id}_${o === answer ? 'correct' : 'wrong'}` })),
          ],
        });
      } else {
        const welcome = group?.welcome_message || 'مرحباً بك في المجموعة! 👋';
        await sendMsg(chatId, `${welcome}\n\nأهلاً <b>${name}</b>! 🎉`);
      }

      await notifyDeveloper(`🆕 <b>عضو جديد!</b>\n👤 ${name}\n🔗 ${member.username ? `@${member.username}` : 'بدون'}\n🆔 <code>${member.id}</code>\n💬 ${groupTitle}`);
    }
    return;
  }

  if (msg.left_chat_member) {
    const m = msg.left_chat_member;
    await notifyDeveloper(`🚪 <b>عضو غادر!</b>\n👤 ${m.first_name || m.username || 'عضو'}\n💬 ${msg.chat.title || 'مجموعة'}`);
    return;
  }

  // ==================== PRE-COMMAND CHECKS ====================
  if (msg.chat.type !== 'private') {
    const { data: group } = await supabase.from('telegram_groups').select('*').eq('chat_id', chatId).single();
    if (group) {
      const admin = await isAdmin(chatId, userId);
      const dev = isDeveloper(userId);

      // Night guard
      if (group.night_mode_start !== null && group.night_mode_end !== null && !admin && !dev) {
        const hour = new Date().getUTCHours();
        const isNight = group.night_mode_start > group.night_mode_end
          ? (hour >= group.night_mode_start || hour < group.night_mode_end)
          : (hour >= group.night_mode_start && hour < group.night_mode_end);
        if (isNight) {
          try { await tgCall('deleteMessage', { chat_id: chatId, message_id: msg.message_id }); } catch {}
          return;
        }
      }

      // Content locks - admins, owner, developer are exempt
      if (group.lock_links && !admin && !dev && msg.entities?.some((e: any) => e.type === 'url' || e.type === 'text_link')) {
        try { await tgCall('deleteMessage', { chat_id: chatId, message_id: msg.message_id }); } catch {}
        await sendMsg(chatId, `⚠️ @${username} الروابط ممنوعة!`);
        return;
      }
      if (group.lock_media && !admin && !dev && (msg.photo || msg.video || msg.animation)) {
        try { await tgCall('deleteMessage', { chat_id: chatId, message_id: msg.message_id }); } catch {}
        return;
      }
      if (group.lock_stickers && !admin && !dev && msg.sticker) {
        try { await tgCall('deleteMessage', { chat_id: chatId, message_id: msg.message_id }); } catch {}
        return;
      }
      if (group.lock_files && !admin && !dev && msg.document) {
        try { await tgCall('deleteMessage', { chat_id: chatId, message_id: msg.message_id }); } catch {}
        return;
      }

      // ===== ANTI-FLOOD: Rate limiting =====
      if (group.anti_flood && !admin && !dev) {
        const maxMsgs = group.flood_max_messages || 5;
        const interval = group.flood_interval_seconds || 3;
        if (detectFlood(userId, chatId, maxMsgs, interval)) {
          try { await tgCall('deleteMessage', { chat_id: chatId, message_id: msg.message_id }); } catch {}
          // Auto-mute for 5 minutes on flood
          await tgCall('restrictChatMember', { 
            chat_id: chatId, user_id: userId, 
            permissions: { can_send_messages: false },
            until_date: Math.floor(Date.now() / 1000) + 300
          }).catch(() => {});
          await sendMsg(chatId, `🚫 <b>${username}</b> تم كتمك 5 دقائق بسبب الفيضان (${maxMsgs}+ رسالة في ${interval} ثوانٍ)`);
          await logAction(supabase, chatId, 0, 'النظام', userId, username, 'auto_mute', 'فيضان رسائل');
          return;
        }
      }

      // ===== ANTI-FORWARD SPAM =====
      if (group.anti_forward_spam && !admin && !dev && (msg.forward_from || msg.forward_from_chat || msg.forward_date)) {
        if (detectForwardSpam(userId, chatId)) {
          try { await tgCall('deleteMessage', { chat_id: chatId, message_id: msg.message_id }); } catch {}
          await tgCall('restrictChatMember', {
            chat_id: chatId, user_id: userId,
            permissions: { can_send_messages: false },
            until_date: Math.floor(Date.now() / 1000) + 600
          }).catch(() => {});
          await sendMsg(chatId, `🚫 <b>${username}</b> تم كتمك 10 دقائق بسبب سبام التوجيه`);
          await logAction(supabase, chatId, 0, 'النظام', userId, username, 'auto_mute', 'سبام توجيه');
          return;
        }
      }

      // ===== BLACKLIST WORDS =====
      if (group.blacklist_words?.length > 0 && !admin && !dev && text) {
        const found = containsBlacklistedWord(text, group.blacklist_words);
        if (found) {
          try { await tgCall('deleteMessage', { chat_id: chatId, message_id: msg.message_id }); } catch {}
          await sendMsg(chatId, `⚠️ <b>${username}</b> رسالتك تحتوي على كلمة محظورة!`);
          await supabase.rpc('update_reputation', { p_user_id: userId, p_chat_id: chatId, p_amount: -3 });
          await logAction(supabase, chatId, 0, 'النظام', userId, username, 'blacklist', `كلمة: ${found}`);
          return;
        }
      }

      // Anti-spam: repeated messages + repeated chars
      if (group.anti_spam && !admin && !dev && text) {
        // Check repeated characters (like "aaaaaaaaaa")
        if (text.length > 5 && /(.)\1{9,}/.test(text)) {
          try { await tgCall('deleteMessage', { chat_id: chatId, message_id: msg.message_id }); } catch {}
          await sendMsg(chatId, `⚠️ <b>${username}</b> توقف عن السبام!`);
          return;
        }
        // Check repeated messages from DB
        const { data: recentMsgs } = await supabase.from('telegram_messages')
          .select('text')
          .eq('chat_id', chatId)
          .eq('user_id', userId)
          .order('created_at', { ascending: false })
          .limit(3);
        if (recentMsgs && recentMsgs.length >= 3) {
          const allSame = recentMsgs.every((m: any) => m.text === text);
          if (allSame) {
            try { await tgCall('deleteMessage', { chat_id: chatId, message_id: msg.message_id }); } catch {}
            await tgCall('restrictChatMember', {
              chat_id: chatId, user_id: userId,
              permissions: { can_send_messages: false },
              until_date: Math.floor(Date.now() / 1000) + 120
            }).catch(() => {});
            await sendMsg(chatId, `⚠️ <b>${username}</b> تم كتمك دقيقتين بسبب السبام!`);
            return;
          }
        }
      }

      // Toxicity filter
      if (group.toxicity_filter && text && !admin && !dev) {
        const { toxic, reason } = await checkToxicity(text);
        if (toxic) {
          try { await tgCall('deleteMessage', { chat_id: chatId, message_id: msg.message_id }); } catch {}
          await sendMsg(chatId, `⚠️ <b>${username}</b> تم حذف رسالتك لاحتوائها على محتوى غير لائق.\nالسبب: ${reason}`);
          await supabase.rpc('update_reputation', { p_user_id: userId, p_chat_id: chatId, p_amount: -5 });
          return;
        }
      }

      // Auto FAQ
      if (group.auto_faq_enabled && text && !text.startsWith('/')) {
        const { data: faqs } = await supabase.from('telegram_faq').select('*').eq('chat_id', chatId);
        if (faqs) {
          const textLower = text.toLowerCase();
          const match = faqs.find((f: any) => {
            if (f.keywords?.some((k: string) => textLower.includes(k.toLowerCase()))) return true;
            if (textLower.includes(f.question.toLowerCase())) return true;
            return false;
          });
          if (match) {
            await sendMsg(chatId, `💡 <b>إجابة تلقائية:</b>\n\n${match.answer}`, undefined, msg.message_id);
            await supabase.from('telegram_faq').update({ usage_count: (match.usage_count || 0) + 1 }).eq('id', match.id);
          }
        }
      }
    }

    // Track activity
    await safeRpc(supabase, 'increment_message_count', { p_user_id: userId, p_chat_id: chatId });
    await safeRpc(supabase, 'update_trust_level', { p_user_id: userId, p_chat_id: chatId });
  }

  // Get bot info
  let botId: number | null = null;
  let botUsername = '';
  try { const me = await tgCall('getMe', {}); botId = me.result?.id || null; botUsername = me.result?.username || ''; } catch {}

  // ==================== PRIVATE MESSAGES - WHISPER HANDLING ====================
  if (msg.chat.type === 'private') {
    if (msg.sticker?.file_id) {
      const stickerSet = msg.sticker.set_name ? `\n🧩 الحزمة: <code>${escapeHtml(msg.sticker.set_name)}</code>` : '';
      await sendMsg(chatId, `🏷️ هذا هو <code>file_id</code> الخاص بالملصق:\n<code>${escapeHtml(msg.sticker.file_id)}</code>${stickerSet}\n\nانسخه والصقه في خانة الملصق داخل الداشبورد.`);
      return;
    }

    const whisperContent = (msg.text ?? msg.caption ?? '').trim();

    if (!whisperContent.startsWith('/')) {
      // Check for pending whisper
      const { data: pendingWhisper } = await supabase.from('telegram_pending_whispers')
        .select('*')
        .eq('from_user_id', userId)
        .order('created_at', { ascending: false })
        .limit(1)
        .single();

      if (pendingWhisper) {
        if (!whisperContent) {
          await sendMsg(chatId, '✍️ اكتب نص الهمسة أو أرسل صورة ومعها caption.');
          return;
        }

        // Save whisper
        const { data: whisperRow } = await supabase.from('telegram_whispers').insert({
          chat_id: pendingWhisper.chat_id,
          from_user_id: userId,
          from_username: pendingWhisper.from_username,
          to_user_id: pendingWhisper.to_user_id,
          to_username: pendingWhisper.to_username,
          message: whisperContent,
        }).select('id').single();

        // Delete pending
        await supabase.from('telegram_pending_whispers').delete().eq('id', pendingWhisper.id);

        if (whisperRow) {
          // Send read button to original group
          await sendMsg(pendingWhisper.chat_id, `💌 لديك همسة جديدة يا <b>${pendingWhisper.to_username}</b>! \n\n<i>من ${pendingWhisper.from_username} - فقط المرسل والمستلم يمكنهما قراءتها</i>`, {
            inline_keyboard: [[{ text: '🔐 قراءة الهمسة', callback_data: `wh:${whisperRow.id}:${pendingWhisper.to_user_id}:${pendingWhisper.from_user_id}` }]]
          });
          await sendMsg(chatId, `✅ تم إرسال الهمسة بنجاح لـ <b>${pendingWhisper.to_username}</b> في المجموعة!`);
        } else {
          await sendMsg(chatId, '❌ حدث خطأ أثناء إرسال الهمسة.');
        }
        return;
      }

      // No pending whisper → talk to Fadi (AI) directly in private chat
      if (whisperContent || (msg.photo && msg.photo.length > 0)) {
        await handleAI(supabase, chatId, userId, username, whisperContent, replyMsg, msg.message_id, msg.photo);
      }
      return;
    }
  }

  // ==================== NON-COMMAND MESSAGES IN GROUPS ====================
  if (!text.startsWith('/') && msg.chat.type !== 'private') {
    // Give points/coins
    await safeRpc(supabase, 'increment_points', { p_user_id: userId, p_chat_id: chatId });
    await safeRpc(supabase, 'increment_coins', { p_user_id: userId, p_chat_id: chatId, p_amount: 1 });
    const { data: usr } = await supabase.from('telegram_users').select('message_count').eq('user_id', userId).eq('chat_id', chatId).single();
    if (usr && usr.message_count % 5 === 0) {
      await safeRpc(supabase, 'update_reputation', { p_user_id: userId, p_chat_id: chatId, p_amount: 1 });
    }

    // ===== WHISPER TRIGGER: "همسة" as reply =====
    const normalizedText = text.trim();
    if ((normalizedText === 'همسة' || normalizedText === 'همسه') && replyMsg && replyMsg.from && !replyMsg.from.is_bot) {
      const recipientId = replyMsg.from.id;
      const recipientName = replyMsg.from.username || replyMsg.from.first_name || String(recipientId);

      // Delete trigger message
      try { await tgCall('deleteMessage', { chat_id: chatId, message_id: msg.message_id }); } catch {}

      // Create pending whisper
      const { data: pendingW } = await supabase.from('telegram_pending_whispers').insert({
        from_user_id: userId,
        from_username: username,
        to_user_id: recipientId,
        to_username: recipientName,
        chat_id: chatId,
      }).select('id').single();

      if (pendingW && botUsername) {
        await sendMsg(chatId, `💌 <b>${username}</b> يريد إرسال همسة سرية لـ <b>${recipientName}</b>`, {
          inline_keyboard: [[{ text: '✍️ اكتب الهمسة', url: `https://t.me/${botUsername}?start=whisper-${pendingW.id}` }]]
        });
      }
      return;
    }

    // ===== AUTO-REPLIES =====
    const autoReply = getAutoReply(text);
    if (autoReply) {
      await sendMsg(chatId, autoReply, undefined, msg.message_id);
      return;
    }

    // ===== AI RESPONSE =====
    const mentionsFadi = text && (text.includes('فادي') || text.toLowerCase().includes('fadi'));
    const isReplyToBot = replyMsg && botId && replyMsg.from?.id === botId;
    const hasPhoto = !!(msg.photo && msg.photo.length > 0);
    const isQuestion = text && (text.includes('؟') || text.includes('?'));
    const mentionsBot = text && botId && msg.entities?.some((e: any) => e.type === 'mention');

    if (mentionsFadi || isReplyToBot || hasPhoto || isQuestion || mentionsBot) {
      await handleAI(supabase, chatId, userId, username, text, replyMsg, msg.message_id, msg.photo);
    }
    return;
  }

  // ==================== COMMAND HANDLING ====================
  const [cmd, ...args] = text.split(/\s+/);
  const command = cmd.toLowerCase().replace(`@${botUsername.toLowerCase()}`, '');

  switch (command) {
    case '/start':
      if (msg.chat.type === 'private') {
        const startParam = args[0] || '';
        if (startParam === 'sticker') {
          await sendMsg(chatId, '🏷️ أرسل الملصق هنا مباشرة وسأعيد لك <code>file_id</code> الجاهز لاستخدامه في الداشبورد.');
        } else if (startParam.startsWith('whisper-')) {
          const pendingId = startParam.substring(8);
          const { data: pending } = await supabase.from('telegram_pending_whispers').select('*').eq('id', pendingId).eq('from_user_id', userId).single();
          if (pending) {
            await sendMsg(chatId, `💌 <b>أرسل همسة سرية لـ ${pending.to_username}</b>\n\n✍️ تفضل بكتابة نص الهمسة الآن.. لن يراها أحد غير المستلم.\n\n<i>اكتب رسالتك في الرسالة التالية</i>`);
          } else {
            await sendMsg(chatId, '❌ انتهت صلاحية الهمسة. أعد المحاولة من المجموعة.');
          }
        } else {
          await sendMsg(chatId, `🤖 <b>منصة Groups Master</b>\n━━━━━━━━━━━━━━━\n\n✨ بوت إدارة احترافي بنظام:\n• 🧠 وكيل ذكاء اصطناعي (فادي)\n• 🛡️ حماية متقدمة ضد السبام والغارات\n• ☁️ <b>استضافة كود</b> Python / JS / TS / Bash\n• 📥 تنزيل فيديوهات (TikTok / YT / IG)\n• 💰 اقتصاد + متجر + تحديات\n• 📊 لوحة تحكم ويب كاملة\n\n👇 <b>اختر من القائمة:</b>`, { inline_keyboard: mainMenuKeyboard(botUsername) });
        }
      } else {
        await sendMsg(chatId, `🤖 <b>أنا جاهز!</b>\n\nاكتب /menu للقائمة الكاملة، أو نادي على <b>فادي</b> للمحادثة.`, { inline_keyboard: mainMenuKeyboard(botUsername, true) });
      }
      break;

    case '/menu': case '/قائمة':
      await sendMsg(chatId, `🎛️ <b>لوحة تحكم Groups Master</b>\n━━━━━━━━━━━━━━━\nاختر القسم اللي عايزه 👇`, { inline_keyboard: mainMenuKeyboard(botUsername, msg.chat.type !== 'private') });
      break;

    case '/help':
      await sendMsg(chatId, helpMenuText('all'), { inline_keyboard: helpCategoriesKeyboard() });
      break;

    case '/dev': case '/developer': case '/owner':
      await sendMsg(chatId, `👨‍💻 <b>المطور</b>\n━━━━━━━━━━\n💬 للتواصل المباشر اضغط الزر:`, { inline_keyboard: [[{ text: '💬 تواصل مع المطور', url: `tg://user?id=${DEVELOPER_ID}` }], [{ text: '📢 قناة الدعم', url: 'https://t.me/Groupmastersupport' }]] });
      break;

    // ==================== AI IMAGE GENERATION ====================
    case '/image': case '/img': case '/صورة': case '/ارسم': case '/draw': {
      let prompt = args.join(' ').trim();
      if (!prompt && replyMsg?.text) prompt = replyMsg.text;
      if (!prompt) { await sendMsg(chatId, '🎨 الاستخدام:\n<code>/image قطة فضائية تطير في الفضاء</code>'); break; }
      await sendMsg(chatId, '🎨 بولّد الصورة... لحظة.');
      await sendAIImage(chatId, prompt, msg.message_id);
      break;
    }

    // ==================== CELEBRATION VIDEO (dev) ====================
    case '/setcelebration': case '/setvideo': {
      if (!isDeveloper(userId)) { await sendMsg(chatId, '🔒 هذا الأمر للمطور فقط.'); break; }
      const vid = replyMsg?.video?.file_id || replyMsg?.animation?.file_id || replyMsg?.document?.file_id;
      if (!vid) { await sendMsg(chatId, '🎬 رد على فيديو (أو GIF) بهذا الأمر لتعيينه كفيديو احتفال إنجاز المهام.'); break; }
      const key = replyMsg?.animation ? 'celebration_animation' : 'celebration_video';
      await supabase.from('telegram_config').upsert({ key, value: vid, updated_at: new Date().toISOString() });
      await sendMsg(chatId, '✅ تم حفظ فيديو الاحتفال! سيظهر عند إنجاز التحديات.');
      break;
    }

    case '/testcelebration': {
      if (!isDeveloper(userId)) { await sendMsg(chatId, '🔒 هذا الأمر للمطور فقط.'); break; }
      await sendCelebration(supabase, chatId, '🎉 <b>تجربة احتفال إنجاز المهمة!</b>');
      break;
    }

    case '/setcookies': case '/setcookie': case '/cookies': {
      if (!isDeveloper(userId)) { await sendMsg(chatId, '🔒 هذا الأمر للمطور فقط.'); break; }
      const doc = replyMsg?.document;
      if (!doc?.file_id) { await sendMsg(chatId, '🍪 رد على ملف <code>cookies.txt</code> (صيغة Netscape) بهذا الأمر.\nالنوع يتحدد تلقائياً (يوتيوب/سبوتيفاي)، أو حدّده: <code>/setcookies spotify</code>'); break; }
      const text = await downloadTgFileText(doc.file_id);
      if (!text) { await sendMsg(chatId, '❌ ما قدرت أقرأ الملف.'); break; }
      const pairs: string[] = [];
      let domain = '';
      for (const line of text.split(/\r?\n/)) {
        if (!line || line.startsWith('#')) continue;
        const parts = line.split('\t');
        if (parts.length >= 7 && parts[5] && parts[6]) {
          pairs.push(`${parts[5].trim()}=${parts[6].trim()}`);
          if (!domain && parts[0]) domain = parts[0].toLowerCase();
        }
      }
      if (pairs.length === 0) { await sendMsg(chatId, '❌ الملف مش بصيغة كوكيز Netscape صحيحة.'); break; }
      const hint = (args[0] || '').toLowerCase();
      const isSpotify = hint === 'spotify' || /spotify/.test(domain) || /spotify/i.test(doc.file_name || '');
      if (isSpotify) {
        await supabase.from('telegram_config').upsert({ key: 'spotify_cookies', value: pairs.join('|'), updated_at: new Date().toISOString() });
        _spTokenCache = null;
        await sendMsg(chatId, `✅ تم تحديث كوكيز سبوتيفاي (${pairs.length} كوكي). أمر <code>/music</code> هيستخدمها دلوقتي.`);
      } else {
        await supabase.from('telegram_config').upsert({ key: 'youtube_cookies', value: pairs.join('|'), updated_at: new Date().toISOString() });
        _ytCookieCacheClear();
        await sendMsg(chatId, `✅ تم تحديث كوكيز يوتيوب (${pairs.length} كوكي). البحث والتنزيل هيستخدموها دلوقتي.`);
      }
      break;
    }




    // ==================== CODE EXECUTION ====================
    case '/run': case '/exec': case '/code': {
      const lang = (args[0] || '').trim();
      let code = args.slice(1).join(' ').trim();
      if (!code && replyMsg?.text) code = replyMsg.text;
      if (!lang || !code) { await sendMsg(chatId, '💻 الاستخدام:\n<code>/run python\nprint("Hello")</code>\n\nأو رد على رسالة فيها كود:\n<code>/run python</code>'); break; }
      await sendMsg(chatId, `⚙️ بشغّل الكود (${escapeHtml(lang)})...`);
      const result = await executeCode(lang, code);
      await sendMsg(chatId, result, undefined, msg.message_id);
      break;
    }

    // ==================== HOSTED PROJECTS ====================
    case '/host': case '/استضافة': case '/project': {
      const sub = (args[0] || '').toLowerCase();
      const HOST_HELP = `☁️ <b>منصة الاستضافة</b>\n━━━━━━━━━━━━━━\n<code>/host new &lt;الاسم&gt; &lt;لغة&gt;</code>\n<code>/host upload &lt;الاسم&gt;</code>  (ردّ على ملف)\n<code>/host list</code>\n<code>/host code &lt;الاسم&gt;</code>\n<code>/host run &lt;الاسم&gt;</code>\n<code>/host logs &lt;الاسم&gt;</code>\n<code>/host delete &lt;الاسم&gt;</code>\n\nاللغات: python, javascript, typescript, bash`;
      if (!sub) { await sendMsg(chatId, HOST_HELP); break; }

      if (sub === 'new' || sub === 'create') {
        const name = (args[1] || '').trim();
        const lang = (args[2] || 'python').toLowerCase();
        if (!name) { await sendMsg(chatId, '❌ حدّد اسم المشروع: <code>/host new myapp python</code>'); break; }
        if (!PISTON_LANGS[lang]) { await sendMsg(chatId, '❌ لغة غير مدعومة. اختر: python / javascript / typescript / bash'); break; }
        const main = lang === 'python' ? 'main.py' : lang === 'javascript' ? 'main.js' : lang === 'typescript' ? 'main.ts' : 'main.sh';
        const seed = lang === 'python' ? 'print("Hello from your hosted project!")' : lang === 'bash' ? 'echo "Hello"' : 'console.log("Hello from your hosted project!")';
        const { error } = await supabase.from('hosted_projects').insert({
          owner_id: userId, owner_username: msg.from.username || null, chat_id: chatId,
          name, language: lang, files: [{ name: main, content: seed }], status: 'idle',
        });
        if (error) { await sendMsg(chatId, error.message.includes('unique') ? '❌ عندك مشروع بنفس الاسم بالفعل' : `❌ ${escapeHtml(error.message)}`); break; }
        await sendMsg(chatId, `✅ <b>تم إنشاء المشروع</b>\n📦 <code>${escapeHtml(name)}</code>\n🔤 ${lang}\n📄 ${main}\n\n▶️ شغّله: <code>/host run ${escapeHtml(name)}</code>\n📤 ضيف ملفات: ردّ على ملف بـ <code>/host upload ${escapeHtml(name)}</code>`, {
          inline_keyboard: [[{ text: '▶️ شغّل', callback_data: `host:run:${name}` }, { text: '📄 الكود', callback_data: `host:code:${name}` }]],
        });
        break;
      }

      if (sub === 'list' || sub === 'ls') {
        const { data: projects } = await supabase.from('hosted_projects').select('name, language, status, run_count, last_run_at, last_exit_code').eq('owner_id', userId).order('updated_at', { ascending: false }).limit(20);
        if (!projects || projects.length === 0) { await sendMsg(chatId, '📭 معندكش مشاريع. ابدأ بـ <code>/host new myapp python</code>'); break; }
        const lines = projects.map((p: any, i: number) => {
          const icon = p.last_exit_code === 0 ? '🟢' : p.last_exit_code == null ? '⚪' : '🔴';
          return `${i+1}. ${icon} <b>${escapeHtml(p.name)}</b> · ${p.language} · شغّل ${p.run_count} مرة`;
        }).join('\n');
        await sendMsg(chatId, `☁️ <b>مشاريعك (${projects.length})</b>\n━━━━━━━━━━━━\n${lines}`);
        break;
      }

      const projName = (args[1] || '').trim();
      if (!projName) { await sendMsg(chatId, HOST_HELP); break; }
      const { data: project } = await supabase.from('hosted_projects').select('*').eq('owner_id', userId).eq('name', projName).single();
      if (!project) { await sendMsg(chatId, `❌ مفيش مشروع باسم <code>${escapeHtml(projName)}</code>`); break; }

      if (sub === 'run' || sub === 'start') {
        await sendMsg(chatId, `⚙️ بشغّل <b>${escapeHtml(projName)}</b>...`);
        await supabase.from('hosted_projects').update({ status: 'running' }).eq('id', project.id);
        const res = await runHostedProject(project);
        await supabase.from('hosted_projects').update({
          status: 'idle', run_count: (project.run_count || 0) + 1,
          last_run_at: new Date().toISOString(), last_output: res.output.slice(0, 4000),
          last_exit_code: res.exitCode, last_duration_ms: res.durationMs,
        }).eq('id', project.id);
        await supabase.from('hosting_runs').insert({
          project_id: project.id, owner_id: userId, status: res.ok ? 'success' : 'failed',
          exit_code: res.exitCode, duration_ms: res.durationMs,
          stdout: res.stdout.slice(0, 4000), stderr: res.stderr.slice(0, 4000),
        });
        const status = res.ok ? '✅' : `⚠️ exit=${res.exitCode}`;
        const out = res.output.length > 3500 ? res.output.slice(0, 3500) + '\n...[مقطوع]' : res.output;
        await sendMsg(chatId, `${status} <b>${escapeHtml(projName)}</b> · ${res.durationMs}ms\n<pre>${escapeHtml(out)}</pre>`, {
          inline_keyboard: [[{ text: '🔄 شغّل تاني', callback_data: `host:run:${projName}` }, { text: '📄 الكود', callback_data: `host:code:${projName}` }]],
        });
        break;
      }

      if (sub === 'code' || sub === 'view') {
        const files = Array.isArray(project.files) ? project.files : [];
        if (files.length === 0) { await sendMsg(chatId, '📭 المشروع فاضي. ضيف ملف بـ /host upload'); break; }
        for (const f of files.slice(0, 5)) {
          const content = (f.content || '').slice(0, 3500);
          await sendMsg(chatId, `📄 <b>${escapeHtml(f.name)}</b>\n<pre>${escapeHtml(content)}</pre>`);
        }
        break;
      }

      if (sub === 'logs' || sub === 'log') {
        const out = project.last_output || '(لم يتم تشغيل المشروع بعد)';
        const status = project.last_exit_code === 0 ? '✅' : project.last_exit_code == null ? '⚪' : `⚠️ exit=${project.last_exit_code}`;
        await sendMsg(chatId, `📜 <b>${escapeHtml(projName)}</b> · ${status} · ${project.last_duration_ms || 0}ms\n<pre>${escapeHtml(out.slice(0, 3500))}</pre>`);
        break;
      }

      if (sub === 'delete' || sub === 'rm' || sub === 'del') {
        await supabase.from('hosted_projects').delete().eq('id', project.id);
        await sendMsg(chatId, `🗑️ تم حذف <b>${escapeHtml(projName)}</b>`);
        break;
      }

      if (sub === 'upload' || sub === 'add') {
        const doc = replyMsg?.document;
        if (!doc) { await sendMsg(chatId, '📤 ردّ على رسالة فيها ملف ثم نفّذ <code>/host upload &lt;الاسم&gt;</code>'); break; }
        if (!isAllowedHostFile(doc.file_name || '')) { await sendMsg(chatId, `❌ نوع الملف غير مسموح. المسموح: ${ALLOWED_HOST_EXTENSIONS.join(', ')}`); break; }
        if (doc.file_size > HOST_MAX_FILE_BYTES) { await sendMsg(chatId, `❌ الملف كبير جداً (الحد ${Math.floor(HOST_MAX_FILE_BYTES/1024)}KB)`); break; }
        const content = await downloadTgFileText(doc.file_id);
        if (content == null) { await sendMsg(chatId, '❌ مقدرتش أحمّل الملف. تأكد إنه نصي وأقل من 512KB وغير مشفّر/تنفيذي.'); break; }
        const fname = doc.file_name || `file_${Date.now()}.txt`;
        const files = Array.isArray(project.files) ? [...project.files] : [];
        // Cap total project files to 20 to prevent abuse
        if (files.length >= 20 && !files.find((f: any) => f.name === fname)) { await sendMsg(chatId, '❌ وصلت للحد الأقصى (20 ملف للمشروع الواحد)'); break; }
        const idx = files.findIndex((f: any) => f.name === fname);
        if (idx >= 0) files[idx] = { name: fname, content }; else files.push({ name: fname, content });
        await supabase.from('hosted_projects').update({ files }).eq('id', project.id);
        await sendMsg(chatId, `✅ تم إضافة <code>${escapeHtml(fname)}</code> (${content.length} حرف · ${files.length}/20 ملف) للمشروع <b>${escapeHtml(projName)}</b>`);
        break;
      }

      await sendMsg(chatId, HOST_HELP);
      break;
    }

    // ==================== VIDEO DOWNLOAD ====================
    case '/download': case '/dl': case '/تنزيل': {
      const url = (args[0] || replyMsg?.text || '').trim();
      if (!url || !/^https?:\/\//i.test(url)) { await sendMsg(chatId, '📥 ابعت رابط:\n<code>/download https://...</code>\n\nمدعوم: تيك توك (فيديو + صور) / يوتيوب / إنستجرام / أي موقع فيه فيديو أو صور'); break; }
      await sendMsg(chatId, '⏳ جاري استخراج الوسائط، لحظة من فضلك...');
      try {
        await handleDownload(chatId, url, supabase, msg.message_id);
      } catch (e) {
        await sendMsg(chatId, humanError('تحميل الوسائط', e), undefined, msg.message_id);
      }
      break;
    }

    // ==================== DEVELOPER-ONLY ADMIN COMMANDS ====================
    case '/send': {
      if (!isDeveloper(userId)) { await sendMsg(chatId, '🔒 هذا الأمر للمطور فقط.'); break; }
      const target = parseInt(args[0]);
      const message = args.slice(1).join(' ');
      if (!target || !message) { await sendMsg(chatId, '🛠️ الاستخدام: <code>/send &lt;user_id&gt; &lt;الرسالة&gt;</code>'); break; }
      try {
        await tgCall('sendMessage', { chat_id: target, text: `📨 <b>رسالة من المطور:</b>\n\n${message}`, parse_mode: 'HTML' });
        await sendMsg(chatId, `✅ تم الإرسال إلى <code>${target}</code>`);
      } catch (e) { await sendMsg(chatId, humanError('الإرسال', e)); }
      break;
    }

    case '/sendmulti': case '/send_multi': {
      if (!isDeveloper(userId)) { await sendMsg(chatId, '🔒 هذا الأمر للمطور فقط.'); break; }
      const idsRaw = args[0] || '';
      const message = args.slice(1).join(' ');
      const ids = idsRaw.split(/[,،\s]+/).map(s => parseInt(s)).filter(n => !isNaN(n));
      if (ids.length === 0 || !message) { await sendMsg(chatId, '🛠️ الاستخدام: <code>/sendmulti 111,222,333 الرسالة</code>'); break; }
      let sent = 0, failed = 0;
      for (const id of ids) {
        try { await tgCall('sendMessage', { chat_id: id, text: `📨 <b>رسالة من المطور:</b>\n\n${message}`, parse_mode: 'HTML' }); sent++; }
        catch { failed++; }
      }
      await sendMsg(chatId, `📊 النتيجة: ✅ ${sent} نجحت | ❌ ${failed} فشلت`);
      break;
    }

    case '/broadcast': {
      if (!isDeveloper(userId)) { await sendMsg(chatId, '🔒 هذا الأمر للمطور فقط.'); break; }
      const message = args.join(' ');
      if (!message) { await sendMsg(chatId, '🛠️ الاستخدام: <code>/broadcast الرسالة</code>'); break; }
      const { data: groups } = await supabase.from('telegram_groups').select('chat_id');
      let sent = 0, failed = 0;
      for (const g of (groups || [])) {
        try { await tgCall('sendMessage', { chat_id: g.chat_id, text: `📢 <b>إشعار من المطور:</b>\n\n${message}`, parse_mode: 'HTML' }); sent++; }
        catch { failed++; }
      }
      await sendMsg(chatId, `📊 البث: ✅ ${sent} مجموعة | ❌ ${failed} فشلت`);
      break;
    }

    case '/togglefeature': case '/toggle_feature': case '/toggle': {
      if (!isDeveloper(userId) && !(await isAdmin(chatId, userId))) { await sendMsg(chatId, '🔒 للمشرفين والمطور فقط.'); break; }
      const feature = args[0];
      const value = (args[1] || '').toLowerCase();
      const allowed = ['anti_spam', 'anti_flood', 'anti_forward_spam', 'captcha_enabled', 'toxicity_filter', 'raid_protection', 'auto_faq_enabled', 'lock_links', 'lock_media', 'lock_stickers', 'lock_files', 'restrict_new_accounts'];
      if (!feature || !allowed.includes(feature)) { await sendMsg(chatId, `🛠️ الاستخدام:\n<code>/toggle &lt;feature&gt; on|off</code>\n\nالميزات:\n${allowed.map(f => `• <code>${f}</code>`).join('\n')}`); break; }
      const newVal = value === 'on' || value === 'true' || value === '1';
      await supabase.from('telegram_groups').update({ [feature]: newVal }).eq('chat_id', chatId);
      await sendMsg(chatId, `${newVal ? '✅' : '🔕'} <b>${feature}</b> = ${newVal ? 'مفعّل' : 'موقوف'}`);
      break;
    }

    case '/retry': case '/retry_failed': {
      if (!isDeveloper(userId)) { await sendMsg(chatId, '🔒 هذا الأمر للمطور فقط.'); break; }
      const { data: failedScheduled } = await supabase.from('telegram_scheduled_messages').select('*').eq('sent', false).lte('scheduled_at', new Date().toISOString()).limit(50);
      let retried = 0;
      for (const m of (failedScheduled || [])) {
        try { await sendMsg(m.chat_id, `⏰ <b>رسالة مجدولة:</b>\n\n${m.message}`); await supabase.from('telegram_scheduled_messages').update({ sent: true }).eq('id', m.id); retried++; } catch {}
      }
      await sendMsg(chatId, `🔁 تمت إعادة محاولة ${retried} رسالة.`);
      break;
    }

    // ==================== SEARCH COMMANDS ====================
    case '/searchbook': case '/كتاب': {
      const query = args.join(' ');
      if (!query) { await sendMsg(chatId, '❌ اكتب اسم الكتاب: /searchbook اسم الكتاب'); break; }
      await sendMsg(chatId, `🔍 جاري البحث عن كتاب "${query}"...`);
      const result = await searchBooks(query);
      await sendMsg(chatId, `📚 <b>نتائج البحث عن كتب:</b>\n\n${result}`);
      break;
    }

    case '/searchyt': case '/يوتيوب': {
      const query = args.join(' ');
      if (!query) { await sendMsg(chatId, '❌ اكتب ما تريد البحث عنه: <code>/searchyt اسم الفيديو</code>'); break; }
      await sendMsg(chatId, `🔍 جاري البحث في يوتيوب عن "${query}"...`);
      try {
        const cookies = await getYouTubeCookies(supabase);
        const results = await ytInnertubeSearch(query, cookies);
        if (results.length === 0) {
          const result = await searchYouTube(query, supabase);
          await sendMsg(chatId, `🎬 <b>نتائج يوتيوب:</b>\n\n${result}`);
          break;
        }
        const lines: string[] = [];
        const buttons: any[] = [];
        const emojis = ['1️⃣', '2️⃣', '3️⃣', '4️⃣', '5️⃣', '6️⃣'];
        results.slice(0, 6).forEach((r, i) => {
          const id = extractYouTubeId(r.url);
          lines.push(`${emojis[i]} <b>${escapeHtml(r.title)}</b>\n   📺 ${escapeHtml(r.snippet)}\n   🔗 <a href="${escapeHtml(r.url)}">مشاهدة</a>`);
          if (id) buttons.push([
            { text: `${emojis[i]} 🎬 فيديو`, callback_data: `ytv:${id}` },
            { text: `🎵 صوت`, callback_data: `yta:${id}` },
          ]);
        });
        await sendMsg(chatId, `🎬 <b>نتائج يوتيوب:</b>\n\n${lines.join('\n\n')}`, buttons.length ? { inline_keyboard: buttons } : undefined);
      } catch (e) {
        await sendMsg(chatId, humanError('بحث يوتيوب', e));
      }
      break;
    }

    case '/music': case '/song': case '/spotify': case '/موسيقى': case '/اغنية': case '/أغنية': {
      const query = args.join(' ');
      if (!query) { await sendMsg(chatId, '🎵 اكتب اسم الأغنية أو الفنان:\n<code>/music عمرو دياب تملي معاك</code>'); break; }
      await sendMsg(chatId, `🎧 جاري البحث في سبوتيفاي عن "${query}"...`);
      try {
        const tracks = await searchSpotify(query, supabase, 5);
        if (tracks.length === 0) {
          // Spotify unavailable → search YouTube directly for the audio
          const id = await ytFindVideoId(`${query} audio`, supabase);
          if (!id) { await sendMsg(chatId, '😕 ما لقيتش الأغنية. جرّب اسم تاني.'); break; }
          await tgCall('sendChatAction', { chat_id: chatId, action: 'upload_voice' }).catch(() => {});
          const audio = await getYouTubeAudio(id, supabase);
          if (!audio) { await sendMsg(chatId, '😕 لقيت الأغنية بس ما قدرتش أحمّل الصوت.'); break; }
          await sendAudioSmart(chatId, audio, { title: query, caption: `🎵 ${escapeHtml(query)}`, replyId: msg.message_id });
          break;
        }
        // List the results with download buttons (resolve YouTube ids in parallel)
        const ids = await Promise.all(tracks.map(t => ytFindVideoId(`${t.title} ${t.artists} audio`, supabase)));
        const lines: string[] = [];
        const buttons: any[] = [];
        const emojis = ['1️⃣', '2️⃣', '3️⃣', '4️⃣', '5️⃣'];
        tracks.forEach((t, i) => {
          const dur = fmtDuration(t.durationMs);
          lines.push(`${emojis[i]} <b>${escapeHtml(t.title)}</b>\n   👤 ${escapeHtml(t.artists)}${dur ? ` · ⏱️ ${dur}` : ''}\n   💿 ${escapeHtml(t.album)}`);
          if (ids[i]) buttons.push([{ text: `${emojis[i]} ⬇️ تحميل: ${t.title.slice(0, 25)}`, callback_data: `yta:${ids[i]}` }]);
        });
        await sendMsg(chatId, `🎵 <b>نتائج سبوتيفاي:</b>\n\n${lines.join('\n\n')}\n\n👇 اضغط لتحميل الأغنية كملف صوتي`, buttons.length ? { inline_keyboard: buttons } : undefined);
      } catch (e) {
        await sendMsg(chatId, humanError('بحث الموسيقى', e));
      }
      break;
    }


    case '/searchweb': case '/بحث': {
      const query = args.join(' ');
      if (!query) { await sendMsg(chatId, '❌ اكتب ما تريد البحث عنه: /searchweb موضوع'); break; }
      await sendMsg(chatId, `🔍 جاري البحث في الويب عن "${query}"...`);
      const result = await searchWeb(query);
      await sendMsg(chatId, `🌐 <b>نتائج البحث:</b>\n\n${result}`);
      break;
    }

    case '/image': case '/img': case '/صورة': case '/صور': {
      const query = args.join(' ');
      if (!query) { await sendMsg(chatId, '🖼️ اكتب ما تريد البحث عنه:\n<code>/image ماهوراجا من جوجيتسو كايسن</code>'); break; }
      await sendMsg(chatId, `🔍 جاري البحث عن صور "${query}"...`);
      const images = await searchImages(query, 6);
      if (images.length === 0) { await sendMsg(chatId, '😕 لم أجد صوراً مناسبة. جرّب كلمات أخرى.'); break; }
      try {
        const media = images.slice(0, 6).map((img, i) => ({
          type: 'photo', media: img, ...(i === 0 ? { caption: `🖼️ نتائج: ${query}` } : {}),
        }));
        await tgCall('sendMediaGroup', { chat_id: chatId, media });
      } catch {
        let sent = 0;
        for (const img of images) { if (await sendPhotoSmart(chatId, img)) sent++; }
        if (sent === 0) await sendMsg(chatId, `😕 تعذّر إرسال الصور. الروابط:\n${images.map((u, i) => `${i + 1}. ${escapeHtml(u)}`).join('\n')}`);
      }
      break;
    }

    case '/searchfile': case '/file': case '/ملف': {
      const fileTypes = ['pdf', 'zip', 'mp3', 'doc', 'docx', 'rar', 'epub', 'apk'];
      let fileType = 'pdf';
      let parts = [...args];
      if (parts[0] && fileTypes.includes(parts[0].toLowerCase())) { fileType = parts.shift()!.toLowerCase(); }
      const query = parts.join(' ');
      if (!query) { await sendMsg(chatId, '📂 ابحث عن ملف:\n<code>/searchfile pdf Python</code>\n\nالأنواع: pdf, zip, mp3, doc, epub, apk'); break; }
      await sendMsg(chatId, `🔍 جاري البحث عن ملفات ${fileType.toUpperCase()} عن "${query}"...`);
      const result = await searchFiles(query, fileType);
      await sendMsg(chatId, `📂 <b>نتائج الملفات:</b>\n\n${result}`);
      break;
    }

    case '/get': case '/getfile': case '/جلب': {
      const url = (args[0] || replyMsg?.text || '').trim();
      if (!url || !/^https?:\/\//i.test(url)) { await sendMsg(chatId, '⬇️ ابعت رابط مباشر:\n<code>/get https://example.com/file.pdf</code>'); break; }
      await sendMsg(chatId, '⏳ جاري جلب الملف...');
      try {
        const info = await fetchFileInfo(url);
        if (info.size > 50 * 1024 * 1024) {
          await sendMsg(chatId, `⚠️ حجم الملف كبير (${(info.size / 1048576).toFixed(1)}MB) ويتجاوز حد تيليجرام (50MB).\n🔗 الرابط المباشر:\n${escapeHtml(url)}`);
          break;
        }
        const isImage = /^image\//i.test(info.contentType) || /\.(jpg|jpeg|png|webp|gif)(\?|$)/i.test(url);
        const isVideo = /^video\//i.test(info.contentType) || /\.(mp4|webm|mov|mkv)(\?|$)/i.test(url);
        // Download bytes and upload directly (handles hotlink-protected CDNs that Telegram can't fetch).
        const got = await fetchBytes(url);
        if (got) {
          try {
            if (isImage) await tgUpload('sendPhoto', { chat_id: chatId, caption: `✅ ${info.name}` }, [{ field: 'photo', bytes: got.bytes, filename: info.name || 'image.jpg', mime: got.mime }]);
            else if (isVideo) await tgUpload('sendVideo', { chat_id: chatId, caption: `✅ ${info.name}`, supports_streaming: 'true' }, [{ field: 'video', bytes: got.bytes, filename: info.name || 'video.mp4', mime: got.mime }]);
            else await tgUpload('sendDocument', { chat_id: chatId, caption: `✅ ${info.name}` }, [{ field: 'document', bytes: got.bytes, filename: info.name || 'file', mime: got.mime }]);
          } catch {
            await sendMsg(chatId, `✅ الرابط جاهز للتحميل:\n${escapeHtml(url)}`);
          }
        } else {
          try {
            if (isImage) await tgCall('sendPhoto', { chat_id: chatId, photo: url, caption: `✅ ${info.name}` });
            else if (isVideo) await tgCall('sendVideo', { chat_id: chatId, video: url, caption: `✅ ${info.name}` });
            else await tgCall('sendDocument', { chat_id: chatId, document: url, caption: `✅ ${info.name}` });
          } catch {
            await sendMsg(chatId, `✅ الرابط جاهز للتحميل:\n${escapeHtml(url)}`);
          }
        }
      } catch (e) {
        await sendMsg(chatId, humanError('جلب الملف', e));
      }
      break;
    }

    case '/browse': case '/تصفح': {
      const url = (args[0] || replyMsg?.text || '').trim();
      if (!url || !/^https?:\/\//i.test(url)) { await sendMsg(chatId, '🌐 ابعت رابط الصفحة:\n<code>/browse https://example.com</code>'); break; }
      await sendMsg(chatId, '⏳ جاري تصفح الصفحة وتلخيصها...');
      const result = await browsePage(url);
      await sendMsg(chatId, result);
      break;
    }

    case '/screenshot': case '/shot': case '/شوت': case '/لقطة': {
      const raw = (args.join(' ') || replyMsg?.text || '').trim();
      const flags = raw.toLowerCase();
      const mobile = /موبايل|جوال|mobile|phone/.test(flags);
      const fullpage = /كامل|كاملة|full|fullpage/.test(flags);
      const url = raw.replace(/موبايل|جوال|mobile|phone|كاملة|كامل|fullpage|full/gi, '').trim();
      if (!url) { await sendMsg(chatId, '📸 ابعت رابط الموقع:\n<code>/screenshot google.com</code>\nأضف <b>موبايل</b> أو <b>كاملة</b> لو حابب.'); break; }
      await sendScreenshot(chatId, url, { mobile, fullpage });
      break;
    }

    case '/open': case '/افتح': {
      const url = (args[0] || replyMsg?.text || '').trim();
      if (!url) { await sendMsg(chatId, '🌐 ابعت رابط الموقع:\n<code>/open example.com</code>'); break; }
      await sendMsg(chatId, '⏳ بفتح الموقع وبصوّره وبلخصه...');
      await openSite(chatId, url, {});
      break;
    }

    case '/weather': case '/طقس': case '/الطقس': {
      const city = args.join(' ');
      if (!city) { await sendMsg(chatId, '🌤️ اكتب اسم المدينة:\n<code>/weather القاهرة</code>'); break; }
      const result = await getWeather(city);
      await sendMsg(chatId, result);
      break;
    }

    case '/crypto': case '/coin': case '/عملة': {
      const coin = args[0];
      if (!coin) { await sendMsg(chatId, '💰 اكتب رمز العملة:\n<code>/crypto btc</code>\nمدعوم: btc, eth, sol, bnb, xrp ...'); break; }
      const result = await getCrypto(coin);
      await sendMsg(chatId, result);
      break;
    }

    case '/translate': case '/tr': case '/ترجم': {
      let target = 'العربية';
      let parts = [...args];
      const langMap: Record<string, string> = { ar: 'العربية', en: 'الإنجليزية', fr: 'الفرنسية', es: 'الإسبانية', de: 'الألمانية', tr: 'التركية', ru: 'الروسية', it: 'الإيطالية', ja: 'اليابانية', zh: 'الصينية' };
      if (parts[0] && langMap[parts[0].toLowerCase()]) { target = langMap[parts.shift()!.toLowerCase()]; }
      let text = parts.join(' ') || replyMsg?.text || '';
      if (!text) { await sendMsg(chatId, '🌍 الاستخدام:\n<code>/translate en مرحبا بالعالم</code>\nأو رد على رسالة بـ <code>/translate ar</code>'); break; }
      await sendMsg(chatId, '⏳ جاري الترجمة...');
      const result = await translateText(target, text);
      await sendMsg(chatId, `🌍 <b>الترجمة (${target}):</b>\n\n${escapeHtml(result)}`);
      break;
    }

    case '/qr': case '/qrcode': {
      const data = args.join(' ') || replyMsg?.text || '';
      if (!data) { await sendMsg(chatId, '📱 اكتب النص أو الرابط:\n<code>/qr https://example.com</code>'); break; }
      try {
        const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=500x500&margin=10&data=${encodeURIComponent(data)}`;
        await tgCall('sendPhoto', { chat_id: chatId, photo: qrUrl, caption: `📱 QR Code:\n${data.slice(0, 200)}` });
      } catch (e) {
        await sendMsg(chatId, humanError('إنشاء QR', e));
      }
      break;
    }

    case '/rss': case '/feed': {
      const url = (args[0] || replyMsg?.text || '').trim();
      if (!url || !/^https?:\/\//i.test(url)) { await sendMsg(chatId, '📰 ابعت رابط RSS:\n<code>/rss https://example.com/feed.xml</code>'); break; }
      await sendMsg(chatId, '⏳ جاري قراءة التغذية...');
      const result = await getRss(url);
      await sendMsg(chatId, result);
      break;
    }



    // ==================== ECONOMY ====================
    case '/daily': {
      const { data: user } = await supabase.from('telegram_users').select('last_daily, daily_streak, coins').eq('user_id', userId).eq('chat_id', chatId).single();
      if (!user) break;
      const now = new Date();
      const lastDaily = user.last_daily ? new Date(user.last_daily) : null;
      const daysDiff = lastDaily ? Math.floor((now.getTime() - lastDaily.getTime()) / 86400000) : 999;

      if (daysDiff < 1) { await sendMsg(chatId, `⏰ لقد حصلت على مكافأتك اليومية بالفعل! عد غداً.`); break; }

      const streak = daysDiff <= 2 ? (user.daily_streak || 0) + 1 : 1;
      const reward = 50 + (streak * 10);
      await supabase.from('telegram_users').update({
        coins: (user.coins || 0) + reward, daily_streak: streak, last_daily: now.toISOString(),
      }).eq('user_id', userId).eq('chat_id', chatId);

      await sendMsg(chatId, `🎁 <b>مكافأة يومية!</b>\n\n💰 حصلت على <b>${reward}</b> عملة\n🔥 سلسلة الأيام: <b>${streak}</b>\n💵 رصيدك: <b>${(user.coins || 0) + reward}</b> عملة`);
      break;
    }

    case '/coins': case '/wallet': case '/balance': {
      const { data: user } = await supabase.from('telegram_users').select('coins, daily_streak').eq('user_id', userId).eq('chat_id', chatId).single();
      await sendMsg(chatId, `💰 <b>محفظتك:</b>\n\n💵 العملات: <b>${user?.coins || 0}</b>\n🔥 سلسلة الأيام: <b>${user?.daily_streak || 0}</b>`);
      break;
    }

    case '/transfer': case '/gift': {
      if (!targetUser) { await sendMsg(chatId, '❌ رد على رسالة الشخص المراد التحويل إليه'); break; }
      const amount = parseInt(args[0]) || 0;
      if (amount <= 0) { await sendMsg(chatId, '❌ حدد المبلغ: /transfer 100'); break; }
      const { data: sender } = await supabase.from('telegram_users').select('coins').eq('user_id', userId).eq('chat_id', chatId).single();
      if (!sender || (sender.coins || 0) < amount) { await sendMsg(chatId, `❌ رصيدك غير كافي (${sender?.coins || 0} عملة)`); break; }
      await supabase.rpc('increment_coins', { p_user_id: userId, p_chat_id: chatId, p_amount: -amount });
      await supabase.rpc('increment_coins', { p_user_id: targetUser.id, p_chat_id: chatId, p_amount: amount });
      await sendMsg(chatId, `💸 <b>${username}</b> حوّل <b>${amount}</b> عملة لـ <b>${targetUser.first_name || targetUser.username}</b> ✅`);
      break;
    }

    case '/shop': {
      const { data: items } = await supabase.from('telegram_shop_items').select('*').eq('chat_id', chatId).eq('is_active', true);
      if (!items || items.length === 0) { await sendMsg(chatId, '🏪 المتجر فارغ حالياً!'); break; }
      const list = items.map((item: any, i: number) => `${i + 1}. <b>${item.name}</b> - ${item.price} 💰\n   ${item.description || ''}`).join('\n\n');
      await sendMsg(chatId, `🏪 <b>المتجر:</b>\n\n${list}\n\n💡 للشراء: /buy [رقم]`);
      break;
    }

    case '/buy': {
      const itemIndex = parseInt(args[0]) - 1;
      const { data: items } = await supabase.from('telegram_shop_items').select('*').eq('chat_id', chatId).eq('is_active', true).order('created_at');
      if (!items || !items[itemIndex]) { await sendMsg(chatId, '❌ رقم غير صحيح. اكتب /shop'); break; }
      const item = items[itemIndex];
      const { data: buyer } = await supabase.from('telegram_users').select('coins').eq('user_id', userId).eq('chat_id', chatId).single();
      if (!buyer || (buyer.coins || 0) < item.price) { await sendMsg(chatId, `❌ رصيدك غير كافي! تحتاج ${item.price} (لديك ${buyer?.coins || 0})`); break; }
      await supabase.rpc('increment_coins', { p_user_id: userId, p_chat_id: chatId, p_amount: -item.price });
      await supabase.from('telegram_purchases').insert({ chat_id: chatId, user_id: userId, item_id: item.id, item_name: item.name, price: item.price });
      if (item.stock > 0) await supabase.from('telegram_shop_items').update({ stock: item.stock - 1 }).eq('id', item.id);
      await sendMsg(chatId, `🎉 <b>${username}</b> اشترى <b>${item.name}</b> بـ ${item.price} 💰`);
      break;
    }

    // ==================== PROFILE & TRUST ====================
    case '/profile': {
      const infoTarget = targetUser || msg.from;
      const { data: u } = await supabase.from('telegram_users').select('*').eq('user_id', infoTarget.id).eq('chat_id', chatId).single();
      if (!u) { await sendMsg(chatId, '❌ لم يتم العثور على بيانات'); break; }
      const memberData = await tgCall('getChatMember', { chat_id: chatId, user_id: infoTarget.id }).catch(() => null);
      await sendMsg(chatId, `📊 <b>بروفايل ${infoTarget.first_name || infoTarget.username}:</b>\n\n👤 الاسم: <b>${infoTarget.first_name || ''} ${infoTarget.last_name || ''}</b>\n🔗 @${infoTarget.username || 'بدون'}\n🆔 <code>${infoTarget.id}</code>\n📊 ${memberData?.result?.status === 'creator' ? '👑 مالك' : memberData?.result?.status === 'administrator' ? '⭐ مشرف' : '👤 عضو'}\n\n💰 العملات: <b>${u.coins || 0}</b>\n🏆 النقاط: <b>${u.points || 0}</b> | المستوى: <b>${u.level || 1}</b>\n⭐ السمعة: <b>${u.reputation || 0}</b>\n🛡️ الثقة: ${trustNames[u.trust_level || 0]}\n💬 الرسائل: <b>${u.message_count || 0}</b>\n⚠️ التحذيرات: <b>${u.warnings || 0}/3</b>`);
      break;
    }

    case '/trust': {
      const { data: u } = await supabase.from('telegram_users').select('trust_level, message_count, reputation').eq('user_id', userId).eq('chat_id', chatId).single();
      const tl = u?.trust_level || 0;
      const nextReqs = ['أرسل 10 رسائل + يوم واحد', '50 رسالة + أسبوع + 5 سمعة', '200 رسالة + شهر + 20 سمعة', '500 رسالة + شهرين + 50 سمعة', '1000 رسالة + 3 شهور + 100 سمعة', 'أنت في أعلى مستوى! 🏆'];
      await sendMsg(chatId, `🛡️ <b>مستوى الثقة:</b>\n\n${trustNames[tl]}\n\n📈 للمستوى التالي:\n${nextReqs[Math.min(tl, 5)]}\n\n💬 رسائلك: ${u?.message_count || 0}\n⭐ سمعتك: ${u?.reputation || 0}`);
      break;
    }

    case '/reputation': case '/rep': {
      if (targetUser && targetUser.id !== userId) {
        await supabase.rpc('update_reputation', { p_user_id: targetUser.id, p_chat_id: chatId, p_amount: 1 });
        await sendMsg(chatId, `⬆️ <b>${username}</b> أعطى +1 سمعة لـ <b>${targetUser.first_name || targetUser.username}</b> ⭐`);
      } else {
        const { data: u } = await supabase.from('telegram_users').select('reputation').eq('user_id', userId).eq('chat_id', chatId).single();
        await sendMsg(chatId, `⭐ سمعتك: <b>${u?.reputation || 0}</b>\n\n💡 رد على رسالة شخص واكتب /rep`);
      }
      break;
    }

    // ==================== COURT ====================
    case '/court': {
      if (!targetUser) { await sendMsg(chatId, '❌ رد على رسالة الشخص المراد تقديمه للمحكمة'); break; }
      const reason = args.join(' ') || 'بدون سبب محدد';
      const expiresAt = new Date(Date.now() + 3600000).toISOString();
      const { data: caseData } = await supabase.from('telegram_court_cases').insert({
        chat_id: chatId, accused_user_id: targetUser.id, accused_username: targetUser.username || targetUser.first_name,
        accuser_user_id: userId, accuser_username: username, reason, expires_at: expiresAt,
      }).select().single();

      if (caseData) {
        await sendMsg(chatId, `⚖️ <b>محكمة الجروب!</b>\n\n🔴 المتهم: <b>${targetUser.first_name || targetUser.username}</b>\n📝 التهمة: ${reason}\n👤 المدعي: <b>${username}</b>\n\n⏰ التصويت لمدة ساعة`, {
          inline_keyboard: [
            [{ text: '✅ مذنب', callback_data: `court_${caseData.id}_guilty` }, { text: '❌ بريء', callback_data: `court_${caseData.id}_innocent` }],
          ],
        });
      }
      break;
    }

    // ==================== TICKETS ====================
    case '/ticket': {
      const subject = args.join(' ');
      if (!subject) { await sendMsg(chatId, '❌ اكتب موضوع التذكرة: /ticket مشكلة في الصلاحيات'); break; }
      await supabase.from('telegram_tickets').insert({ chat_id: chatId, user_id: userId, username, subject });
      await sendMsg(chatId, `🎫 <b>تم فتح تذكرة!</b>\n\n📝 ${subject}\n👤 ${username}\n📊 مفتوحة`);
      await notifyDeveloper(`🎫 <b>تذكرة جديدة!</b>\nمن: ${username}\nالموضوع: ${subject}`);
      break;
    }

    // ==================== FAQ ====================
    case '/addfaq': {
      if (!(await isAdmin(chatId, userId)) && !isDeveloper(userId)) { await sendMsg(chatId, '❌ للمشرفين فقط'); break; }
      const parts = args.join(' ').split('|');
      if (parts.length < 2) { await sendMsg(chatId, '❌ الصيغة: /addfaq السؤال | الإجابة | كلمات,مفتاحية'); break; }
      await supabase.from('telegram_faq').insert({ chat_id: chatId, question: parts[0].trim(), answer: parts[1].trim(), keywords: parts[2]?.trim().split(',').map(k => k.trim()) || [], created_by: userId });
      await sendMsg(chatId, `✅ تم إضافة FAQ!`);
      break;
    }

    case '/faq': {
      const { data: faqs } = await supabase.from('telegram_faq').select('*').eq('chat_id', chatId).order('usage_count', { ascending: false }).limit(10);
      if (!faqs || faqs.length === 0) { await sendMsg(chatId, '📋 لا توجد أسئلة شائعة بعد'); break; }
      const list = faqs.map((f: any, i: number) => `${i + 1}. <b>${f.question}</b>\n   ${f.answer}`).join('\n\n');
      await sendMsg(chatId, `📋 <b>الأسئلة الشائعة:</b>\n\n${list}`);
      break;
    }

    // ==================== SAVE & SCHEDULE ====================
    case '/save': {
      if (!replyMsg) { await sendMsg(chatId, '❌ رد على الرسالة المراد حفظها'); break; }
      const tag = args[0] || 'general';
      await supabase.from('telegram_saved_messages').insert({ chat_id: chatId, message_id: replyMsg.message_id, saved_by: userId, text: replyMsg.text || '(بدون نص)', tag });
      await sendMsg(chatId, `📌 تم حفظ الرسالة بتاج: <b>#${tag}</b>`);
      break;
    }

    case '/saved': {
      const tag = args[0];
      let query = supabase.from('telegram_saved_messages').select('*').eq('chat_id', chatId).order('created_at', { ascending: false }).limit(10);
      if (tag) query = query.eq('tag', tag);
      const { data: saved } = await query;
      if (!saved || saved.length === 0) { await sendMsg(chatId, '📌 لا توجد رسائل محفوظة'); break; }
      const list = saved.map((s: any) => `#${s.tag} | ${s.text?.substring(0, 50) || '...'}`).join('\n');
      await sendMsg(chatId, `📌 <b>الرسائل المحفوظة:</b>\n\n${list}`);
      break;
    }

    case '/schedule': {
      if (!(await isAdmin(chatId, userId)) && !isDeveloper(userId)) { await sendMsg(chatId, '❌ للمشرفين فقط'); break; }
      const timeStr = args[0];
      const message = args.slice(1).join(' ');
      if (!timeStr || !message) { await sendMsg(chatId, '❌ الصيغة: /schedule 30m رسالة'); break; }
      const unit = timeStr.slice(-1);
      const value = parseInt(timeStr.slice(0, -1));
      if (isNaN(value)) { await sendMsg(chatId, '❌ وقت غير صحيح'); break; }
      const ms = unit === 'h' ? value * 3600000 : value * 60000;
      const scheduledAt = new Date(Date.now() + ms).toISOString();
      await supabase.from('telegram_scheduled_messages').insert({ chat_id: chatId, message, scheduled_at: scheduledAt, created_by: userId });
      await sendMsg(chatId, `⏰ تم جدولة الرسالة بعد ${value}${unit === 'h' ? ' ساعة' : ' دقيقة'}`);
      break;
    }

    // ==================== PROTECTION COMMANDS ====================
    case '/captcha': {
      if (!(await isAdmin(chatId, userId)) && !isDeveloper(userId)) { await sendMsg(chatId, '❌ للمشرفين فقط'); break; }
      const on = args[0] === 'on';
      await supabase.from('telegram_groups').update({ captcha_enabled: on }).eq('chat_id', chatId);
      await sendMsg(chatId, on ? '🔒 تم تفعيل نظام الكابتشا' : '🔓 تم إيقاف الكابتشا');
      break;
    }

    case '/nightmode': {
      if (!(await isAdmin(chatId, userId)) && !isDeveloper(userId)) { await sendMsg(chatId, '❌ للمشرفين فقط'); break; }
      if (args[0] === 'off') {
        await supabase.from('telegram_groups').update({ night_mode_start: null, night_mode_end: null }).eq('chat_id', chatId);
        await sendMsg(chatId, '🌙 تم إيقاف الوضع الليلي');
      } else {
        const start = parseInt(args[0]) || 23;
        const end = parseInt(args[1]) || 6;
        await supabase.from('telegram_groups').update({ night_mode_start: start, night_mode_end: end }).eq('chat_id', chatId);
        await sendMsg(chatId, `🌙 تم تفعيل الوضع الليلي من <b>${start}:00</b> إلى <b>${end}:00</b> UTC`);
      }
      break;
    }

    case '/toxicity': {
      if (!(await isAdmin(chatId, userId)) && !isDeveloper(userId)) { await sendMsg(chatId, '❌ للمشرفين فقط'); break; }
      const on = args[0] === 'on';
      await supabase.from('telegram_groups').update({ toxicity_filter: on }).eq('chat_id', chatId);
      await sendMsg(chatId, on ? '🛡️ تم تفعيل فلتر المحتوى السام' : '🛡️ تم إيقاف الفلتر');
      break;
    }

    case '/slowmode': {
      if (!(await isAdmin(chatId, userId)) && !isDeveloper(userId)) { await sendMsg(chatId, '❌ للمشرفين فقط'); break; }
      const seconds = parseInt(args[0]) || 0;
      try {
        await tgCall('setChatSlowMode' as any, { chat_id: chatId, slow_mode_delay: seconds });
        await supabase.from('telegram_groups').update({ slow_mode_seconds: seconds }).eq('chat_id', chatId);
        await sendMsg(chatId, seconds > 0 ? `🐌 الوضع البطيء: رسالة كل <b>${seconds}</b> ثانية` : '🐌 تم إيقاف الوضع البطيء');
      } catch { await sendMsg(chatId, '❌ فشل'); }
      break;
    }

    case '/antispam': {
      if (!(await isAdmin(chatId, userId)) && !isDeveloper(userId)) { await sendMsg(chatId, '❌ للمشرفين والمطور فقط'); break; }
      const on = args[0] === 'on';
      await supabase.from('telegram_groups').update({ anti_spam: on }).eq('chat_id', chatId);
      await sendMsg(chatId, on ? '🛡 تم تفعيل مضاد السبام' : '🛡 تم إيقاف مضاد السبام');
      break;
    }

    case '/antiflood': {
      if (!(await isAdmin(chatId, userId)) && !isDeveloper(userId)) { await sendMsg(chatId, '❌ للمشرفين فقط'); break; }
      if (args[0] === 'off') {
        await supabase.from('telegram_groups').update({ anti_flood: false }).eq('chat_id', chatId);
        await sendMsg(chatId, '🔓 تم إيقاف مضاد الفيضان');
      } else {
        const maxMsgs = parseInt(args[0]) || 5;
        const interval = parseInt(args[1]) || 3;
        await supabase.from('telegram_groups').update({ anti_flood: true, flood_max_messages: maxMsgs, flood_interval_seconds: interval }).eq('chat_id', chatId);
        await sendMsg(chatId, `🛡️ مضاد الفيضان: <b>${maxMsgs}</b> رسائل / <b>${interval}</b> ثوانٍ\nالعقوبة: كتم 5 دقائق`);
      }
      break;
    }

    case '/blacklist': {
      if (!(await isAdmin(chatId, userId)) && !isDeveloper(userId)) { await sendMsg(chatId, '❌ للمشرفين فقط'); break; }
      if (!args[0]) {
        const { data: g } = await supabase.from('telegram_groups').select('blacklist_words').eq('chat_id', chatId).single();
        const words = g?.blacklist_words || [];
        await sendMsg(chatId, words.length > 0 
          ? `🚫 <b>الكلمات المحظورة (${words.length}):</b>\n${words.map((w: string, i: number) => `${i+1}. ${w}`).join('\n')}\n\n➕ /blacklist add كلمة\n➖ /blacklist remove كلمة\n🗑 /blacklist clear`
          : '🚫 لا توجد كلمات محظورة\n\n➕ /blacklist add كلمة');
        break;
      }
      if (args[0] === 'add' && args[1]) {
        const word = args.slice(1).join(' ');
        const { data: g } = await supabase.from('telegram_groups').select('blacklist_words').eq('chat_id', chatId).single();
        const words = [...(g?.blacklist_words || []), word];
        await supabase.from('telegram_groups').update({ blacklist_words: words }).eq('chat_id', chatId);
        await sendMsg(chatId, `✅ تم إضافة "<b>${word}</b>" للقائمة السوداء`);
      } else if (args[0] === 'remove' && args[1]) {
        const word = args.slice(1).join(' ');
        const { data: g } = await supabase.from('telegram_groups').select('blacklist_words').eq('chat_id', chatId).single();
        const words = (g?.blacklist_words || []).filter((w: string) => w.toLowerCase() !== word.toLowerCase());
        await supabase.from('telegram_groups').update({ blacklist_words: words }).eq('chat_id', chatId);
        await sendMsg(chatId, `✅ تم إزالة "<b>${word}</b>" من القائمة السوداء`);
      } else if (args[0] === 'clear') {
        await supabase.from('telegram_groups').update({ blacklist_words: [] }).eq('chat_id', chatId);
        await sendMsg(chatId, '✅ تم مسح القائمة السوداء');
      }
      break;
    }

    case '/restrict_new': {
      if (!(await isAdmin(chatId, userId)) && !isDeveloper(userId)) { await sendMsg(chatId, '❌ للمشرفين فقط'); break; }
      if (args[0] === 'off') {
        await supabase.from('telegram_groups').update({ restrict_new_accounts: false }).eq('chat_id', chatId);
        await sendMsg(chatId, '🔓 تم إيقاف تقييد الحسابات الجديدة');
      } else {
        const days = parseInt(args[0]) || 7;
        await supabase.from('telegram_groups').update({ restrict_new_accounts: true, new_account_days: days }).eq('chat_id', chatId);
        await sendMsg(chatId, `🔒 تقييد الحسابات الجديدة: <b>${days}</b> أيام (نص فقط)`);
      }
      break;
    }

    case '/security': {
      if (msg.chat.type === 'private') break;
      const { data: g } = await supabase.from('telegram_groups').select('*').eq('chat_id', chatId).single();
      if (!g) break;
      await sendMsg(chatId, `🛡️ <b>حالة الحماية:</b>\n\n` +
        `${g.anti_spam ? '✅' : '❌'} مضاد السبام\n` +
        `${g.anti_flood ? '✅' : '❌'} مضاد الفيضان ${g.anti_flood ? `(${g.flood_max_messages}/${g.flood_interval_seconds}s)` : ''}\n` +
        `${g.anti_forward_spam ? '✅' : '❌'} مضاد سبام التوجيه\n` +
        `${g.captcha_enabled ? '✅' : '❌'} كابتشا (طرد تلقائي بعد دقيقتين)\n` +
        `${g.toxicity_filter ? '✅' : '❌'} فلتر المحتوى السام\n` +
        `${g.raid_protection ? '✅' : '❌'} حماية من الغارات\n` +
        `${g.restrict_new_accounts ? '✅' : '❌'} تقييد حسابات جديدة ${g.restrict_new_accounts ? `(${g.new_account_days} أيام)` : ''}\n` +
        `${g.night_mode_start !== null ? '✅' : '❌'} الوضع الليلي ${g.night_mode_start !== null ? `(${g.night_mode_start}-${g.night_mode_end})` : ''}\n` +
        `${(g.blacklist_words || []).length > 0 ? '✅' : '❌'} قائمة سوداء (${(g.blacklist_words || []).length} كلمة)\n` +
        `${g.lock_links ? '✅' : '❌'} قفل الروابط\n` +
        `${g.lock_media ? '✅' : '❌'} قفل الوسائط\n` +
        `${g.lock_stickers ? '✅' : '❌'} قفل الملصقات\n` +
        `${g.lock_files ? '✅' : '❌'} قفل الملفات`);
      break;
    }

    // ==================== CHALLENGE ====================
    case '/challenge': {
      const today = new Date().toISOString().split('T')[0];
      let { data: challenge } = await supabase.from('telegram_challenges').select('*').eq('chat_id', chatId).eq('active_date', today).eq('is_active', true).single();

      if (!challenge) {
        const challenges = [
          { title: 'مرسال اليوم 📨', description: 'أرسل 20 رسالة اليوم', challenge_type: 'message_count', target_value: 20, reward_coins: 100, reward_points: 30 },
          { title: 'الودود 💕', description: 'أعط سمعة لـ 3 أعضاء', challenge_type: 'give_rep', target_value: 3, reward_coins: 75, reward_points: 25 },
          { title: 'المتفاعل 🎯', description: 'أرسل 50 رسالة اليوم', challenge_type: 'message_count', target_value: 50, reward_coins: 200, reward_points: 60 },
        ];
        const random = challenges[Math.floor(Math.random() * challenges.length)];
        const { data: newChallenge } = await supabase.from('telegram_challenges').insert({ chat_id: chatId, ...random, active_date: today }).select().single();
        challenge = newChallenge;
      }

      if (challenge) {
        await sendMsg(chatId, `🏆 <b>تحدي اليوم: ${challenge.title}</b>\n\n📝 ${challenge.description}\n🎯 الهدف: ${challenge.target_value}\n💰 المكافأة: ${challenge.reward_coins} عملة + ${challenge.reward_points} نقطة`);
      }
      break;
    }

    case '/mychallenges': {
      const today = new Date().toISOString().split('T')[0];
      const { data: challenge } = await supabase.from('telegram_challenges').select('*').eq('chat_id', chatId).eq('active_date', today).eq('is_active', true).single();
      if (!challenge) { await sendMsg(chatId, '❌ لا يوجد تحدي نشط. اكتب /challenge'); break; }
      const { data: existing } = await supabase.from('telegram_challenge_completions').select('id').eq('challenge_id', challenge.id).eq('user_id', userId).single();
      if (existing) { await sendMsg(chatId, '✅ أكملت تحدي اليوم بالفعل!'); break; }
      const { data: user } = await supabase.from('telegram_users').select('message_count').eq('user_id', userId).eq('chat_id', chatId).single();
      const progress = user?.message_count || 0;
      if (progress >= challenge.target_value) {
        await supabase.from('telegram_challenge_completions').insert({ challenge_id: challenge.id, chat_id: chatId, user_id: userId });
        await supabase.rpc('increment_coins', { p_user_id: userId, p_chat_id: chatId, p_amount: challenge.reward_coins });
        await sendCelebration(supabase, chatId, `🎉 <b>${username} أكمل التحدي!</b>\n\n🏆 ${challenge.title}\n💰 +${challenge.reward_coins} عملة`);
      } else {
        await sendMsg(chatId, `📊 التقدم: ${progress}/${challenge.target_value}\n\nاستمر! 💪`);
      }
      break;
    }

    // ==================== STATS ====================
    case '/stats': {
      if (msg.chat.type === 'private') break;
      const { data: members } = await supabase.from('telegram_users').select('*').eq('chat_id', chatId);
      if (!members) break;
      const total = members.length;
      const banned = members.filter((m: any) => m.is_banned).length;
      const muted = members.filter((m: any) => m.is_muted).length;
      const totalMsgs = members.reduce((s: number, m: any) => s + (m.message_count || 0), 0);
      const totalCoins = members.reduce((s: number, m: any) => s + (m.coins || 0), 0);
      let totalCount = 0;
      try { const c = await tgCall('getChatMembersCount', { chat_id: chatId }); totalCount = c.result || 0; } catch {}
      await sendMsg(chatId, `📊 <b>إحصائيات المجموعة:</b>\n\n👥 الأعضاء: <b>${totalCount || total}</b>\n🚫 محظور: <b>${banned}</b>\n🔇 مكتوم: <b>${muted}</b>\n💬 الرسائل: <b>${totalMsgs}</b>\n💰 العملات: <b>${totalCoins}</b>`);
      break;
    }

    // ==================== ADMIN COMMANDS ====================
    case '/id':
      if (targetUser) await sendMsg(chatId, `🆔 <b>${targetUser.first_name || targetUser.username}</b>: <code>${targetUser.id}</code>`);
      else await sendMsg(chatId, `🆔 معرفك: <code>${userId}</code>\n💬 المجموعة: <code>${chatId}</code>`);
      break;

    case '/info':
      if (targetUser || msg.from) {
        const t = targetUser || msg.from;
        const { data: u } = await supabase.from('telegram_users').select('*').eq('user_id', t.id).eq('chat_id', chatId).single();
        await sendMsg(chatId, `📊 <b>${t.first_name || t.username}:</b>\n🆔 <code>${t.id}</code> | 🏆 ${u?.points || 0} | ⭐ ${u?.reputation || 0} | 💰 ${u?.coins || 0} | ⚠️ ${u?.warnings || 0}/3 | 🛡️ ${trustNames[u?.trust_level || 0]}`);
      }
      break;

    case '/tagall': case '/all': case '/everyone':
      if (!(await isAdmin(chatId, userId)) && !isDeveloper(userId)) { await sendMsg(chatId, '❌ للمشرفين فقط'); break; }
      await tagAllMembers(supabase, chatId, username);
      break;

    case '/ban': case '/unban': case '/kick': case '/mute': case '/unmute': case '/warn': case '/unwarn': case '/promote': case '/demote': {
      if (!targetUser && command !== '/unban') { await sendMsg(chatId, '❌ رد على رسالة العضو'); break; }
      if (!(await isAdmin(chatId, userId)) && !isDeveloper(userId)) { await sendMsg(chatId, '❌ للمشرفين فقط'); break; }
      const tgt = targetUser!;
      const tgtName = tgt.first_name || tgt.username || String(tgt.id);
      try {
        switch (command) {
          case '/ban': await tgCall('banChatMember', { chat_id: chatId, user_id: tgt.id }); await supabase.from('telegram_users').update({ is_banned: true }).eq('user_id', tgt.id).eq('chat_id', chatId); await logAction(supabase, chatId, userId, username, tgt.id, tgtName, 'ban'); await sendMsg(chatId, `🚫 تم حظر <b>${tgtName}</b>`); break;
          case '/unban': await tgCall('unbanChatMember', { chat_id: chatId, user_id: tgt.id, only_if_banned: true }); await supabase.from('telegram_users').update({ is_banned: false }).eq('user_id', tgt.id).eq('chat_id', chatId); await logAction(supabase, chatId, userId, username, tgt.id, tgtName, 'unban'); await sendMsg(chatId, `✅ تم إلغاء حظر <b>${tgtName}</b>`); break;
          case '/kick': await tgCall('banChatMember', { chat_id: chatId, user_id: tgt.id }); await tgCall('unbanChatMember', { chat_id: chatId, user_id: tgt.id }); await logAction(supabase, chatId, userId, username, tgt.id, tgtName, 'kick'); await sendMsg(chatId, `👢 تم طرد <b>${tgtName}</b>`); break;
          case '/mute': await tgCall('restrictChatMember', { chat_id: chatId, user_id: tgt.id, permissions: { can_send_messages: false } }); await supabase.from('telegram_users').update({ is_muted: true }).eq('user_id', tgt.id).eq('chat_id', chatId); await logAction(supabase, chatId, userId, username, tgt.id, tgtName, 'mute'); await sendMsg(chatId, `🔇 تم كتم <b>${tgtName}</b>`); break;
          case '/unmute': await tgCall('restrictChatMember', { chat_id: chatId, user_id: tgt.id, permissions: { can_send_messages: true, can_send_media_messages: true, can_send_other_messages: true, can_add_web_page_previews: true } }); await supabase.from('telegram_users').update({ is_muted: false }).eq('user_id', tgt.id).eq('chat_id', chatId); await logAction(supabase, chatId, userId, username, tgt.id, tgtName, 'unmute'); await sendMsg(chatId, `🔊 تم إلغاء كتم <b>${tgtName}</b>`); break;
          case '/warn': { const { data: u } = await supabase.from('telegram_users').select('warnings').eq('user_id', tgt.id).eq('chat_id', chatId).single(); const nw = (u?.warnings || 0) + 1; await supabase.from('telegram_users').update({ warnings: nw, total_warns: nw }).eq('user_id', tgt.id).eq('chat_id', chatId); await logAction(supabase, chatId, userId, username, tgt.id, tgtName, 'warn', `${nw}/3`); if (nw >= 3) { await tgCall('banChatMember', { chat_id: chatId, user_id: tgt.id }); await tgCall('unbanChatMember', { chat_id: chatId, user_id: tgt.id }); await sendMsg(chatId, `⚠️ <b>${tgtName}</b> وصل 3 تحذيرات وتم طرده!`); } else { await sendMsg(chatId, `⚠️ تحذير <b>${tgtName}</b> (${nw}/3)`); } break; }
          case '/unwarn': { const { data: u } = await supabase.from('telegram_users').select('warnings').eq('user_id', tgt.id).eq('chat_id', chatId).single(); const nw = Math.max(0, (u?.warnings || 0) - 1); await supabase.from('telegram_users').update({ warnings: nw }).eq('user_id', tgt.id).eq('chat_id', chatId); await sendMsg(chatId, `✅ إزالة تحذير <b>${tgtName}</b> (${nw}/3)`); break; }
          case '/promote': await tgCall('promoteChatMember', { chat_id: chatId, user_id: tgt.id, can_delete_messages: true, can_restrict_members: true, can_pin_messages: true, can_invite_users: true }); await logAction(supabase, chatId, userId, username, tgt.id, tgtName, 'promote'); await sendMsg(chatId, `⬆️ تم ترقية <b>${tgtName}</b> ⭐`); break;
          case '/demote': await tgCall('promoteChatMember', { chat_id: chatId, user_id: tgt.id, can_delete_messages: false, can_restrict_members: false, can_pin_messages: false }); await logAction(supabase, chatId, userId, username, tgt.id, tgtName, 'demote'); await sendMsg(chatId, `⬇️ تم تخفيض <b>${tgtName}</b>`); break;
        }
      } catch (e) { await sendMsg(chatId, '❌ فشلت العملية'); }
      break;
    }

    case '/lock': {
      if (!(await isAdmin(chatId, userId)) && !isDeveloper(userId)) { await sendMsg(chatId, '❌ للمشرفين فقط'); break; }
      const lockMap: Record<string, string> = { links: 'lock_links', media: 'lock_media', stickers: 'lock_stickers', files: 'lock_files' };
      if (lockMap[args[0]]) { await supabase.from('telegram_groups').update({ [lockMap[args[0]]]: true }).eq('chat_id', chatId); await sendMsg(chatId, `🔒 تم قفل ${args[0]}`); }
      else await sendMsg(chatId, '❌ استخدم: /lock links|media|stickers|files');
      break;
    }

    case '/unlock': {
      if (!(await isAdmin(chatId, userId)) && !isDeveloper(userId)) { await sendMsg(chatId, '❌ للمشرفين فقط'); break; }
      const unlockMap: Record<string, string> = { links: 'lock_links', media: 'lock_media', stickers: 'lock_stickers', files: 'lock_files' };
      if (unlockMap[args[0]]) { await supabase.from('telegram_groups').update({ [unlockMap[args[0]]]: false }).eq('chat_id', chatId); await sendMsg(chatId, `🔓 تم فتح ${args[0]}`); }
      else await sendMsg(chatId, '❌ استخدم: /unlock links|media|stickers|files');
      break;
    }

    case '/setwelcome': {
      if (!(await isAdmin(chatId, userId)) && !isDeveloper(userId)) { await sendMsg(chatId, '❌ للمشرفين فقط'); break; }
      const wt = args.join(' ');
      if (!wt) { await sendMsg(chatId, '❌ اكتب الرسالة بعد الأمر'); break; }
      await supabase.from('telegram_groups').update({ welcome_message: wt }).eq('chat_id', chatId);
      await sendMsg(chatId, `✅ رسالة الترحيب: ${wt}`);
      break;
    }

    case '/pin': {
      if (!replyMsg) { await sendMsg(chatId, '❌ رد على الرسالة'); break; }
      if (!(await isAdmin(chatId, userId)) && !isDeveloper(userId)) { await sendMsg(chatId, '❌ للمشرفين فقط'); break; }
      try { await tgCall('pinChatMessage', { chat_id: chatId, message_id: replyMsg.message_id }); await sendMsg(chatId, '📌 تم التثبيت'); } catch { await sendMsg(chatId, '❌ فشل'); }
      break;
    }

    case '/unpin': {
      if (!(await isAdmin(chatId, userId)) && !isDeveloper(userId)) { await sendMsg(chatId, '❌ للمشرفين فقط'); break; }
      try { if (replyMsg) await tgCall('unpinChatMessage', { chat_id: chatId, message_id: replyMsg.message_id }); else await tgCall('unpinAllChatMessages', { chat_id: chatId }); await sendMsg(chatId, '📌 تم إلغاء التثبيت'); } catch { await sendMsg(chatId, '❌ فشل'); }
      break;
    }

    case '/report': {
      if (!targetUser) { await sendMsg(chatId, '❌ رد على رسالة المخالف'); break; }
      await sendMsg(chatId, `🚨 <b>بلاغ!</b>\nمن: ${username}\nضد: ${targetUser.first_name || targetUser.username}\n⚠️ تم إخطار المشرفين`);
      await logAction(supabase, chatId, userId, username, targetUser.id, targetUser.username || targetUser.first_name, 'report', args.join(' ') || 'بدون سبب');
      break;
    }

    // ==================== WHISPER COMMAND ====================
    case '/whisper': {
      if (msg.chat.type === 'private') { await sendMsg(chatId, '❌ استخدم هذا الأمر في المجموعة بالرد على رسالة الشخص'); break; }
      if (!targetUser) { await sendMsg(chatId, '❌ رد على رسالة الشخص الذي تريد إرسال همسة له'); break; }
      if (targetUser.is_bot) { await sendMsg(chatId, '❌ لا يمكنك إرسال همسة لبوت'); break; }

      try { await tgCall('deleteMessage', { chat_id: chatId, message_id: msg.message_id }); } catch {}

      const { data: pendingW } = await supabase.from('telegram_pending_whispers').insert({
        from_user_id: userId, from_username: username,
        to_user_id: targetUser.id, to_username: targetUser.username || targetUser.first_name || String(targetUser.id),
        chat_id: chatId,
      }).select('id').single();

      if (pendingW && botUsername) {
        await sendMsg(chatId, `💌 <b>${username}</b> يريد إرسال همسة سرية لـ <b>${targetUser.first_name || targetUser.username}</b>`, {
          inline_keyboard: [[{ text: '✍️ اكتب الهمسة', url: `https://t.me/${botUsername}?start=whisper-${pendingW.id}` }]]
        });
      }
      break;
    }

    case '/sticker': case '/getsticker': {
      if (msg.chat.type === 'private') {
        await sendMsg(chatId, '🏷️ أرسل الملصق هنا مباشرة وسأعيد لك <code>file_id</code> الجاهز لاستخدامه في الداشبورد.');
      } else if (botUsername) {
        await sendMsg(chatId, '🏷️ للحصول على <code>file_id</code> للملصق، افتح الخاص مع البوت ثم أرسل الملصق هناك.', {
          inline_keyboard: [[{ text: 'فتح البوت للملصقات', url: `https://t.me/${botUsername}?start=sticker` }]],
        });
      } else {
        await sendMsg(chatId, '🏷️ افتح الخاص مع البوت وأرسل الملصق هناك للحصول على file_id.');
      }
      break;
    }

    // ==================== ENTERTAINMENT ====================
    case '/top': { const { data: top } = await supabase.from('telegram_users').select('*').eq('chat_id', chatId).order('points', { ascending: false }).limit(10); if (top && top.length > 0) { const m = ['🥇', '🥈', '🥉']; const l = top.map((u: any, i: number) => `${m[i] || `${i+1}.`} <b>${u.first_name || u.username || u.user_id}</b> - ${u.points}⭐ ${u.coins}💰`).join('\n'); await sendMsg(chatId, `🏆 <b>ترتيب الأعضاء:</b>\n\n${l}`); } break; }
    case '/points': { const { data: u } = await supabase.from('telegram_users').select('points, level, coins, reputation').eq('user_id', userId).eq('chat_id', chatId).single(); if (u) await sendMsg(chatId, `🏆 النقاط: <b>${u.points}</b> | المستوى: <b>${u.level}</b> | 💰 ${u.coins} | ⭐ ${u.reputation}`); break; }
    case '/roll': { const d = Math.floor(Math.random() * 6) + 1; await sendMsg(chatId, `🎲 <b>${username}</b> حصل على: <b>${d}</b>`); break; }
    case '/flip': { await sendMsg(chatId, `🪙 النتيجة: <b>${Math.random() > 0.5 ? 'صورة' : 'كتابة'}</b>`); break; }
    case '/random': { const { data: rm } = await supabase.from('telegram_users').select('*').eq('chat_id', chatId).eq('is_banned', false); if (rm && rm.length > 0) { const r = rm[Math.floor(Math.random() * rm.length)]; await sendMsg(chatId, `🎲 <a href="tg://user?id=${r.user_id}">${r.first_name || r.username || r.user_id}</a> 🎉`); } break; }
    case '/quiz': { const q = quizzes[Math.floor(Math.random() * quizzes.length)]; await sendMsg(chatId, `❓ <b>${q.q}</b>`, { inline_keyboard: q.options.map((o, i) => [{ text: o, callback_data: `quiz_${i}_${q.answer}` }]) }); break; }
    case '/game': { const n = Math.floor(Math.random() * 10) + 1; const btns = Array.from({ length: 10 }, (_, i) => [{ text: `${i+1}`, callback_data: `game_${i+1}_${n}` }]).reduce((r: any[], b, i) => { if (i % 5 === 0) r.push([]); r[r.length-1].push(b[0]); return r; }, []); await sendMsg(chatId, `🎮 <b>خمن الرقم (1-10)!</b>`, { inline_keyboard: btns }); break; }
    case '/truth': await sendMsg(chatId, `🤔 <b>حقيقة:</b>\n\n${truths[Math.floor(Math.random() * truths.length)]}`); break;
    case '/dare': await sendMsg(chatId, `🔥 <b>تحدي:</b>\n\n${dares[Math.floor(Math.random() * dares.length)]}`); break;
    case '/joke': await sendMsg(chatId, `😂 <b>نكتة:</b>\n\n${jokes[Math.floor(Math.random() * jokes.length)]}`); break;

    case '/hack': {
      if (!targetUser) { await sendMsg(chatId, '❌ رد على رسالة العضو 😈'); break; }
      const name = targetUser.first_name || targetUser.username || 'المستهدف';
      let msgId: number | null = null;
      for (let i = 0; i < hackMessages.length; i++) {
        await new Promise(r => setTimeout(r, 1200));
        if (i === 0) { const res = await sendMsg(chatId, `🎯 <b>هدف: ${name}</b>\n\n${hackMessages[i]}`); msgId = res.result?.message_id; }
        else if (msgId) { try { await tgCall('editMessageText', { chat_id: chatId, message_id: msgId, text: `🎯 <b>هدف: ${name}</b>\n\n${hackMessages.slice(0, i + 1).join('\n')}${i === hackMessages.length - 1 ? `\n\n✅ <b>تم!</b> 😂 مزحة يا ${name}!` : ''}`, parse_mode: 'HTML' }); } catch {} }
      }
      break;
    }
  }
}

// ==================== CALLBACK HANDLER ====================

async function handleCallback(supabase: any, cq: any) {
  const data = cq.data;
  const userId = cq.from.id;
  const chatId = cq.message?.chat.id;


  // Menu navigation
  if (data.startsWith('menu:') || data.startsWith('help:')) {
    const [kind, key] = data.split(':');
    await tgCall('answerCallbackQuery', { callback_query_id: cq.id });
    if (kind === 'menu' && key === 'main') {
      const me = await tgCall('getMe').catch(() => ({ result: { username: 'bot' } }));
      const botUsername = me?.result?.username || 'bot';
      await tgCall('editMessageText', { chat_id: chatId, message_id: cq.message.message_id, text: `🎛️ <b>لوحة تحكم Groups Master</b>\n━━━━━━━━━━━━━━━\nاختر القسم اللي عايزه 👇`, parse_mode: 'HTML', reply_markup: { inline_keyboard: mainMenuKeyboard(botUsername, cq.message.chat.type !== 'private') } });
      return;
    }
    if (kind === 'menu' && key === 'help') {
      await tgCall('editMessageText', { chat_id: chatId, message_id: cq.message.message_id, text: helpMenuText('all'), parse_mode: 'HTML', reply_markup: { inline_keyboard: helpCategoriesKeyboard() } });
      return;
    }
    const cat = key === 'main' ? 'all' : key;
    await tgCall('editMessageText', { chat_id: chatId, message_id: cq.message.message_id, text: helpMenuText(cat), parse_mode: 'HTML', reply_markup: { inline_keyboard: helpCategoriesKeyboard() } });
    return;
  }

  // Host quick actions
  if (data.startsWith('host:')) {
    const [, action, ...rest] = data.split(':');
    const name = rest.join(':');
    const { data: project } = await supabase.from('hosted_projects').select('*').eq('owner_id', userId).eq('name', name).single();
    if (!project) { await tgCall('answerCallbackQuery', { callback_query_id: cq.id, text: '❌ المشروع غير موجود', show_alert: true }); return; }
    if (action === 'run') {
      await tgCall('answerCallbackQuery', { callback_query_id: cq.id, text: '⚙️ بشغّل...' });
      const res = await runHostedProject(project);
      await supabase.from('hosted_projects').update({ run_count: (project.run_count || 0) + 1, last_run_at: new Date().toISOString(), last_output: res.output.slice(0, 4000), last_exit_code: res.exitCode, last_duration_ms: res.durationMs }).eq('id', project.id);
      await supabase.from('hosting_runs').insert({ project_id: project.id, owner_id: userId, status: res.ok ? 'success' : 'failed', exit_code: res.exitCode, duration_ms: res.durationMs, stdout: res.stdout.slice(0, 4000), stderr: res.stderr.slice(0, 4000) });
      const status = res.ok ? '✅' : `⚠️ exit=${res.exitCode}`;
      const out = res.output.length > 3500 ? res.output.slice(0, 3500) + '\n...[مقطوع]' : res.output;
      await sendMsg(chatId, `${status} <b>${escapeHtml(name)}</b> · ${res.durationMs}ms\n<pre>${escapeHtml(out)}</pre>`, { inline_keyboard: [[{ text: '🔄 شغّل تاني', callback_data: `host:run:${name}` }, { text: '📄 الكود', callback_data: `host:code:${name}` }]] });
      return;
    }
    if (action === 'code') {
      await tgCall('answerCallbackQuery', { callback_query_id: cq.id });
      const files = Array.isArray(project.files) ? project.files : [];
      for (const f of files.slice(0, 5)) {
        await sendMsg(chatId, `📄 <b>${escapeHtml(f.name)}</b>\n<pre>${escapeHtml((f.content || '').slice(0, 3500))}</pre>`);
      }
      return;
    }
  }

  // YouTube video/audio download from search results
  if (data.startsWith('ytv:') || data.startsWith('yta:')) {
    const [kind, videoId] = data.split(':');
    const isAudio = kind === 'yta';
    await tgCall('answerCallbackQuery', { callback_query_id: cq.id, text: isAudio ? '🎵 جاري تحميل الصوت...' : '🎬 جاري تحميل الفيديو...' });
    try {
      await tgCall('sendChatAction', { chat_id: chatId, action: isAudio ? 'upload_voice' : 'upload_video' }).catch(() => {});
      if (isAudio) {
        const audio = await getYouTubeAudio(videoId, supabase);
        if (!audio) { await sendMsg(chatId, '😕 ما قدرتش أحمّل الصوت. جرّب نتيجة تانية.'); return; }
        await sendAudioSmart(chatId, audio, { caption: '🎵 تفضّل الصوت', title: 'audio' });
      } else {
        const res = await downloadVideo(`https://www.youtube.com/watch?v=${videoId}`, supabase);
        if (res.ok && res.videoUrl) await sendVideoSmart(chatId, res.videoUrl, '✅ تفضّل الفيديو');
        else await sendMsg(chatId, res.message);
      }
    } catch (e) {
      await sendMsg(chatId, humanError('التحميل', e));
    }
    return;
  }


    const [, sel, cor] = data.split('_');
    if (sel === cor) {
      await supabase.rpc('increment_points', { p_user_id: userId, p_chat_id: chatId }).catch(() => {});
      await supabase.rpc('increment_coins', { p_user_id: userId, p_chat_id: chatId, p_amount: 5 }).catch(() => {});
      await tgCall('answerCallbackQuery', { callback_query_id: cq.id, text: '✅ صح! +10 نقاط +5 عملات 🎉', show_alert: true });
    } else {
      await tgCall('answerCallbackQuery', { callback_query_id: cq.id, text: '❌ خطأ! حاول مرة أخرى', show_alert: true });
    }
  } else if (data.startsWith('game_')) {
    const [, guess, answer] = data.split('_');
    if (guess === answer) {
      await supabase.rpc('increment_points', { p_user_id: userId, p_chat_id: chatId }).catch(() => {});
      await supabase.rpc('increment_coins', { p_user_id: userId, p_chat_id: chatId, p_amount: 10 }).catch(() => {});
      await tgCall('answerCallbackQuery', { callback_query_id: cq.id, text: `🎉 صح! +10 نقاط +10 عملات`, show_alert: true });
    } else {
      await tgCall('answerCallbackQuery', { callback_query_id: cq.id, text: `❌ خطأ! الرقم كان ${answer}`, show_alert: true });
    }
  } else if (data.startsWith('wh:')) {
    // Whisper format: wh:whisperID:toUserID:fromUserID
    const parts = data.split(':');
    const wId = parts[1];
    const toId = parts[2];
    const fromId = parts[3] || '';

    // Allow both sender and recipient to read
    if (String(userId) !== toId && String(userId) !== fromId) {
      await tgCall('answerCallbackQuery', { callback_query_id: cq.id, text: '🔒 هذه الهمسة ليست لك! توقف عن التلصص! ❌', show_alert: true });
      return;
    }

    const { data: w } = await supabase.from('telegram_whispers').select('message, from_username, to_username').eq('id', wId).single();
    if (w) {
      const whisperBody = (w.message || '').trim();
      const whisperText = `💌 همسة من ${w.from_username} لـ ${w.to_username}:\n\n${whisperBody || '⚠️ الهمسة فارغة.'}`;
      await tgCall('answerCallbackQuery', { callback_query_id: cq.id, text: whisperText.slice(0, 200), show_alert: true });
      await supabase.from('telegram_whispers').update({ is_read: true }).eq('id', wId);
    } else {
      await tgCall('answerCallbackQuery', { callback_query_id: cq.id, text: '❌ الهمسة غير موجودة أو تم حذفها', show_alert: true });
    }
  } else if (data.startsWith('captcha_')) {
    const [, memberId, result] = data.split('_');
    if (String(userId) !== memberId) { await tgCall('answerCallbackQuery', { callback_query_id: cq.id, text: '❌ ليس لك!', show_alert: true }); return; }
    if (result === 'correct') {
      await tgCall('restrictChatMember', { chat_id: chatId, user_id: userId, permissions: { can_send_messages: true, can_send_media_messages: true, can_send_other_messages: true, can_add_web_page_previews: true } });
      await supabase.from('telegram_users').update({ captcha_verified: true }).eq('user_id', userId).eq('chat_id', chatId);
      await supabase.from('telegram_captcha_pending').delete().eq('chat_id', chatId).eq('user_id', userId);
      await tgCall('answerCallbackQuery', { callback_query_id: cq.id, text: '✅ تم التحقق! مرحباً بك', show_alert: true });
      const { data: group } = await supabase.from('telegram_groups').select('welcome_message').eq('chat_id', chatId).single();
      await sendMsg(chatId, `${group?.welcome_message || 'مرحباً!'}\n\n✅ <b>${cq.from.first_name || 'عضو'}</b> اجتاز التحقق 🎉`);
    } else {
      await tgCall('answerCallbackQuery', { callback_query_id: cq.id, text: '❌ إجابة خاطئة! حاول مرة أخرى', show_alert: true });
    }
  } else if (data.startsWith('court_')) {
    const [, caseId, verdict] = data.split('_');
    const { data: existing } = await supabase.from('telegram_court_votes').select('id').eq('case_id', caseId).eq('user_id', userId).single();
    if (existing) { await tgCall('answerCallbackQuery', { callback_query_id: cq.id, text: '❌ لقد صوتت بالفعل!', show_alert: true }); return; }

    const vote = verdict === 'guilty';
    await supabase.from('telegram_court_votes').insert({ case_id: caseId, user_id: userId, vote });

    const field = vote ? 'votes_for' : 'votes_against';
    const { data: courtCase } = await supabase.from('telegram_court_cases').select('*').eq('id', caseId).single();
    if (courtCase) {
      const newCount = (courtCase[field] || 0) + 1;
      await supabase.from('telegram_court_cases').update({ [field]: newCount }).eq('id', caseId);
      await tgCall('answerCallbackQuery', { callback_query_id: cq.id, text: `✅ تم تسجيل صوتك: ${vote ? 'مذنب' : 'بريء'}`, show_alert: true });

      const totalVotes = (courtCase.votes_for || 0) + (courtCase.votes_against || 0) + 1;
      if (totalVotes >= 5) {
        const guilty = (vote ? newCount : courtCase.votes_for || 0) > (vote ? courtCase.votes_against || 0 : newCount);
        await supabase.from('telegram_court_cases').update({ status: 'closed', verdict: guilty ? 'guilty' : 'innocent' }).eq('id', caseId);
        if (guilty) {
          await sendMsg(chatId, `⚖️ <b>حكم المحكمة: مذنب!</b>\n\n${courtCase.accused_username} تم إدانته. كتم لمدة ساعة.`);
          await tgCall('restrictChatMember', { chat_id: chatId, user_id: courtCase.accused_user_id, permissions: { can_send_messages: false }, until_date: Math.floor(Date.now() / 1000) + 3600 });
        } else {
          await sendMsg(chatId, `⚖️ <b>حكم المحكمة: بريء!</b>\n\n${courtCase.accused_username} تمت تبرئته ✅`);
        }
      }
    }
  }
}

// ==================== CAPTCHA TIMEOUT CHECK ====================

async function checkCaptchaTimeouts(supabase: any) {
  const cutoff = new Date(Date.now() - 120000).toISOString(); // 2 minutes
  const { data: expired } = await supabase.from('telegram_captcha_pending')
    .select('chat_id, user_id')
    .lte('created_at', cutoff);
  
  if (expired && expired.length > 0) {
    for (const entry of expired) {
      try {
        // Kick (ban then unban)
        await tgCall('banChatMember', { chat_id: entry.chat_id, user_id: entry.user_id });
        await tgCall('unbanChatMember', { chat_id: entry.chat_id, user_id: entry.user_id });
        await sendMsg(entry.chat_id, `🚫 تم طرد عضو لعدم حل الكابتشا خلال دقيقتين`);
        await supabase.from('telegram_captcha_pending').delete().eq('chat_id', entry.chat_id).eq('user_id', entry.user_id);
      } catch (e) { console.error('Captcha timeout kick error:', e); }
    }
  }
}

// ==================== SCHEDULED MESSAGES CHECK ====================

async function checkScheduledMessages(supabase: any) {
  const { data: msgs } = await supabase.from('telegram_scheduled_messages').select('*').eq('sent', false).lte('scheduled_at', new Date().toISOString());
  if (msgs) {
    for (const m of msgs) {
      try {
        await sendMsg(m.chat_id, `⏰ <b>رسالة مجدولة:</b>\n\n${m.message}`);
        await supabase.from('telegram_scheduled_messages').update({ sent: true }).eq('id', m.id);
      } catch (e) { console.error('Scheduled msg error:', e); }
    }
  }
}

// ==================== MAIN POLLING LOOP ====================

const MAX_RUNTIME_MS = 55_000;
const MIN_REMAINING_MS = 5_000;

Deno.serve(async (req) => {
  const startTime = Date.now();

  // ===== WEBHOOK MODE: Telegram POSTs an update directly =====
  let webhookUpdate: any = null;
  if (req.method === 'POST') {
    try {
      const body = await req.json();
      if (body && typeof body.update_id === 'number') webhookUpdate = body;
    } catch { /* not JSON, fall through to cron */ }
  }

  if (webhookUpdate) {
    try {
      const supabase = getSupabase();
      if (webhookUpdate.message) {
        const m = webhookUpdate.message;
        await supabase.from('telegram_messages').upsert({
          update_id: webhookUpdate.update_id, chat_id: m.chat.id, user_id: m.from?.id || null,
          username: m.from?.username || null, text: m.text ?? null, raw_update: webhookUpdate,
        }, { onConflict: 'update_id' });
        await handleCommand(supabase, webhookUpdate);
      }
      if (webhookUpdate.callback_query) await handleCallback(supabase, webhookUpdate.callback_query);
      return new Response(JSON.stringify({ ok: true }), { headers: corsHeaders });
    } catch (e: any) {
      try { await logSystem('error', 'webhook_handler_failed', e?.message || String(e), { update_id: webhookUpdate.update_id }); } catch {}
      return new Response(JSON.stringify({ ok: true, error: e?.message }), { headers: corsHeaders }); // ALWAYS return 200 to Telegram
    }
  }

  // ===== CRON MODE: scheduled tasks + fallback polling =====
  try {
    const supabase = getSupabase();
    let totalProcessed = 0;

    await checkScheduledMessages(supabase);
    await checkCaptchaTimeouts(supabase);

    // Skip getUpdates if webhook is registered (saves time)
    const { data: state, error: stateErr } = await supabase.from('telegram_bot_state').select('update_offset, webhook_active').eq('id', 1).single();
    if (stateErr) return new Response(JSON.stringify({ error: stateErr.message }), { status: 500, headers: corsHeaders });
    if ((state as any).webhook_active) {
      return new Response(JSON.stringify({ ok: true, mode: 'webhook', cron_only: true }), { headers: corsHeaders });
    }

    let currentOffset = state.update_offset;

    while (true) {
      const elapsed = Date.now() - startTime;
      const remainingMs = MAX_RUNTIME_MS - elapsed;
      if (remainingMs < MIN_REMAINING_MS) break;

      const timeout = Math.min(50, Math.floor(remainingMs / 1000) - 5);
      if (timeout < 1) break;

      const response = await fetch(`${GATEWAY_URL}/getUpdates`, {
        method: 'POST', headers: getHeaders(),
        body: JSON.stringify({ offset: currentOffset, timeout, allowed_updates: ['message', 'callback_query'] }),
      });

      const data = await response.json();
      if (!response.ok) return new Response(JSON.stringify({ error: data }), { status: 502, headers: corsHeaders });

      const updates = data.result ?? [];
      if (updates.length === 0) continue;

      const msgRows = updates.filter((u: any) => u.message).map((u: any) => ({
        update_id: u.update_id, chat_id: u.message.chat.id, user_id: u.message.from?.id || null, username: u.message.from?.username || null, text: u.message.text ?? null, raw_update: u,
      }));
      if (msgRows.length > 0) await supabase.from('telegram_messages').upsert(msgRows, { onConflict: 'update_id' });

      for (const update of updates) {
        try {
          if (update.message) await handleCommand(supabase, update);
          if (update.callback_query) await handleCallback(supabase, update.callback_query);
        } catch (e: any) {
          console.error('Error:', e);
          await logSystem('error', 'update_handler_failed', e?.message || String(e), { update_id: update.update_id });
        }
      }

      totalProcessed += updates.length;
      const newOffset = Math.max(...updates.map((u: any) => u.update_id)) + 1;
      await supabase.from('telegram_bot_state').update({ update_offset: newOffset, updated_at: new Date().toISOString() }).eq('id', 1);
      currentOffset = newOffset;
    }

    return new Response(JSON.stringify({ ok: true, processed: totalProcessed }), { headers: corsHeaders });
  } catch (error: any) {
    console.error('Poll error:', error);
    try { await logSystem('error', 'poll_loop_failed', error?.message || String(error)); } catch {}
    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown' }), { status: 500, headers: corsHeaders });
  }
});
