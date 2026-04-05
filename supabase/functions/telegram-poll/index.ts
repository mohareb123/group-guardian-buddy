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

async function callAI(prompt: string, systemPrompt: string, imageUrl?: string): Promise<string> {
  const userContent: any = imageUrl
    ? [{ type: 'text', text: prompt }, { type: 'image_url', image_url: { url: imageUrl } }]
    : prompt;

  const res = await fetch(AI_GATEWAY_URL, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${getEnv('LOVABLE_API_KEY')}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'google/gemini-2.5-flash',
      messages: [{ role: 'system', content: systemPrompt }, { role: 'user', content: userContent }],
    }),
  });
  if (!res.ok) throw new Error(`AI error: ${res.status}`);
  const data = await res.json();
  return data.choices?.[0]?.message?.content || '';
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

  const systemPrompt = `أنت فادي، مساعد ذكي لمجموعات تيليجرام. كن مهنياً ومفيداً وجاداً. تجنب المزاح إلا إذا طُلب منك ذلك صراحةً. أجب بدقة واختصار.
المستخدم: ${username} (ID:${userId}) | مشرف: ${isUserAdmin ? 'نعم' : 'لا'} | المطور: ${isOwner ? 'نعم' : 'لا'}
المجموعة: ${groupInfo?.title || 'مجموعة'} | أعضاء: ${(groupMembers || []).length}
${replyMsg ? `الرد على: ${replyMsg.from?.first_name || 'مجهول'} (ID:${replyMsg.from?.id}) - "${replyMsg.text || '(وسائط)'}"` : ''}

قواعد مهمة:
- كن جاداً ومختصراً (2-3 أسطر).
- لا تمزح إلا إذا طُلب.
- إذا طلب المستخدم إجراء إداري وكان مشرفاً أو المطور، أضف: [ACTION:{"type":"ban/kick/mute/unmute/warn","target_user_id":123}]
- يمكنك تنفيذ أوامر مثل: حظر، طرد، كتم، إلغاء كتم، تحذير، ترقية، تخفيض، تثبيت رسالة.
- إذا طلب المستخدم إجراءً إدارياً بلغة طبيعية (مثل "احظر هذا" أو "اطرده") وكان مشرفاً/المطور، نفذ الأمر.
- لا تُنشئ JSON إلا عند طلب إداري.`;

  try {
    const userPrompt = text || (imageUrl ? 'صورة مرسلة، صفها بإيجاز' : '');
    if (!userPrompt && !imageUrl) return;

    const reply = await callAI(userPrompt, systemPrompt, imageUrl);
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
    if (cleanReply) await sendMsg(chatId, `🤖 ${cleanReply}`, undefined, messageId);
  } catch (e) { console.error('AI error:', e); }
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

async function searchYouTube(query: string): Promise<string> {
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

      if (group?.captcha_enabled) {
        const num1 = Math.floor(Math.random() * 10) + 1;
        const num2 = Math.floor(Math.random() * 10) + 1;
        const answer = num1 + num2;
        await tgCall('restrictChatMember', { chat_id: chatId, user_id: member.id, permissions: { can_send_messages: false } });
        await sendMsg(chatId, `🔒 <b>تحقق أمني لـ ${name}</b>\n\nأجب على السؤال للمتابعة:\n❓ كم يساوي <b>${num1} + ${num2}</b>؟`, {
          inline_keyboard: [
            [{ text: `${answer - 1}`, callback_data: `captcha_${member.id}_wrong` }, { text: `${answer}`, callback_data: `captcha_${member.id}_correct` }, { text: `${answer + 1}`, callback_data: `captcha_${member.id}_wrong` }],
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

      // Anti-spam: only affects normal members, not admins/owner/developer
      if (group.anti_spam && !admin && !dev && text) {
        // Simple spam detection: repeated messages
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
            await sendMsg(chatId, `⚠️ <b>${username}</b> توقف عن السبام!`);
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

      return; // Ignore other private non-command messages
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
          await sendMsg(chatId, `🤖 <b>مرحباً! أنا بوت إدارة المجموعات</b>\n\n✨ أقدر أساعدك في:\n🧠 إدارة بالذكاء الاصطناعي\n💰 نظام اقتصادي\n🏆 تحديات يومية\n🛡️ حماية متقدمة\n📊 تتبع سلوك الأعضاء\n🔍 بحث شامل\n\n📋 اكتب /help للأوامر`, {
            inline_keyboard: [
              [{ text: '👨‍💻 المطور', url: `tg://user?id=${DEVELOPER_ID}` }],
              [{ text: '➕ أضفني لمجموعتك', url: `https://t.me/${botUsername}?startgroup=true` }],
            ],
          });
        }
      } else {
        await sendMsg(chatId, `🤖 <b>أنا جاهز!</b> تكلم مع <b>فادي</b> أو اكتب /help`, { inline_keyboard: [[{ text: '👨‍💻 المطور', url: `tg://user?id=${DEVELOPER_ID}` }]] });
      }
      break;

    case '/help':
      await sendMsg(chatId, `📋 <b>الأوامر:</b>\n\n🤖 <b>ذكاء اصطناعي:</b> اذكر "فادي"\n\n👑 <b>إدارة:</b>\n/ban /unban /kick /mute /unmute /warn /unwarn /promote /demote /pin /unpin /report\n\n🔒 <b>حماية:</b>\n/lock /unlock /antispam /nightmode /captcha /toxicity /slowmode\n\n💰 <b>اقتصاد:</b>\n/coins /daily /shop /buy /gift /transfer\n\n🔍 <b>بحث:</b>\n/searchbook /searchyt /searchweb\n\n🏆 <b>تحديات:</b>\n/challenge /mychallenges\n\n📊 <b>تتبع:</b>\n/profile /trust /reputation /stats\n\n⚖️ <b>محكمة:</b>\n/court\n\n📝 <b>أدوات:</b>\n/faq /addfaq /save /saved /ticket /schedule /sticker\n\n🎮 <b>ترفيه:</b>\n/quiz /game /truth /dare /joke /hack /roll /flip /random\n\n💌 <b>همسات:</b> رد على رسالة واكتب "همسة" أو /whisper\n\n📢 /tagall /all\nℹ️ /id /info /top /points /dev`);
      break;

    case '/dev': case '/developer': case '/owner':
      await sendMsg(chatId, `👨‍💻 <b>المطور:</b>`, { inline_keyboard: [[{ text: '💬 تواصل مع المطور', url: `tg://user?id=${DEVELOPER_ID}` }]] });
      break;

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
      if (!query) { await sendMsg(chatId, '❌ اكتب ما تريد البحث عنه: /searchyt موضوع'); break; }
      await sendMsg(chatId, `🔍 جاري البحث في يوتيوب عن "${query}"...`);
      const result = await searchYouTube(query);
      await sendMsg(chatId, `🎬 <b>نتائج يوتيوب:</b>\n\n${result}`);
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
        await sendMsg(chatId, `🎉 <b>${username} أكمل التحدي!</b>\n\n🏆 ${challenge.title}\n💰 +${challenge.reward_coins} عملة`);
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

  if (data.startsWith('quiz_')) {
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

Deno.serve(async () => {
  const startTime = Date.now();

  try {
    const supabase = getSupabase();
    let totalProcessed = 0;

    await checkScheduledMessages(supabase);

    const { data: state, error: stateErr } = await supabase.from('telegram_bot_state').select('update_offset').eq('id', 1).single();
    if (stateErr) return new Response(JSON.stringify({ error: stateErr.message }), { status: 500, headers: corsHeaders });

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
        } catch (e) { console.error('Error:', e); }
      }

      totalProcessed += updates.length;
      const newOffset = Math.max(...updates.map((u: any) => u.update_id)) + 1;
      await supabase.from('telegram_bot_state').update({ update_offset: newOffset, updated_at: new Date().toISOString() }).eq('id', 1);
      currentOffset = newOffset;
    }

    return new Response(JSON.stringify({ ok: true, processed: totalProcessed }), { headers: corsHeaders });
  } catch (error) {
    console.error('Poll error:', error);
    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown' }), { status: 500, headers: corsHeaders });
  }
});
