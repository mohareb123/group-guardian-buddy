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
  await supabase.from('telegram_admin_logs').insert({
    chat_id: chatId,
    admin_user_id: adminUserId,
    admin_username: adminUsername,
    target_user_id: targetUserId,
    target_username: targetUsername,
    action,
    details,
  });
}

async function ensureUser(supabase: any, userId: number, chatId: number, username?: string, firstName?: string, lastName?: string) {
  await supabase.from('telegram_users').upsert({
    user_id: userId,
    chat_id: chatId,
    username: username || null,
    first_name: firstName || null,
    last_name: lastName || null,
  }, { onConflict: 'user_id,chat_id' });
}

async function ensureGroup(supabase: any, chatId: number, title?: string) {
  await supabase.from('telegram_groups').upsert({
    chat_id: chatId,
    title: title || null,
  }, { onConflict: 'chat_id' });
}

async function isAdmin(chatId: number, userId: number): Promise<boolean> {
  try {
    const data = await tgCall('getChatMember', { chat_id: chatId, user_id: userId });
    return ['administrator', 'creator'].includes(data.result?.status);
  } catch { return false; }
}

function isDeveloper(userId: number): boolean {
  return userId === DEVELOPER_ID;
}

// ==================== NOTIFY DEVELOPER ====================

async function notifyDeveloper(text: string) {
  try {
    await sendMsg(DEVELOPER_ID, text);
  } catch (e) {
    console.error('Failed to notify developer:', e);
  }
}

// ==================== MENTION/TAG ALL ====================

async function tagAllMembers(supabase: any, chatId: number, callerUsername: string) {
  // Get all members from DB
  const { data: members } = await supabase
    .from('telegram_users')
    .select('username, first_name, user_id')
    .eq('chat_id', chatId)
    .eq('is_banned', false);

  // Also get total count from Telegram
  let totalCount = 0;
  try {
    const countData = await tgCall('getChatMembersCount', { chat_id: chatId });
    totalCount = countData.result || 0;
  } catch {}

  if (!members || members.length === 0) {
    await sendMsg(chatId, '❌ لا يوجد أعضاء مسجلين بعد. الأعضاء يتم تسجيلهم تلقائياً عند إرسال أي رسالة.');
    return;
  }

  await sendMsg(chatId, `📢 <b>نداء عام من ${callerUsername}!</b>\n👥 يتم مناداة <b>${members.length}</b> عضو${totalCount > members.length ? ` من أصل ${totalCount}` : ''}...`);

  // Use text mentions (tg://user?id=X) which notify users even without username
  // Split into chunks of 5 per message to ensure notifications work
  const chunks: string[][] = [];
  for (let i = 0; i < members.length; i += 5) {
    const chunk = members.slice(i, i + 5).map((m: any) => {
      const name = m.first_name || m.username || String(m.user_id);
      // Always use tg://user?id= format for guaranteed notification
      return `<a href="tg://user?id=${m.user_id}">${name}</a>`;
    });
    chunks.push(chunk);
  }

  for (const chunk of chunks) {
    await sendMsg(chatId, `📣 ${chunk.join(' | ')}`);
    // Delay between messages to avoid rate limiting
    await new Promise(r => setTimeout(r, 800));
  }

  await sendMsg(chatId, `✅ تم مناداة <b>${members.length}</b> عضو بنجاح!`);
}

// ==================== AI ASSISTANT "فادي" ====================

async function handleAI(supabase: any, chatId: number, userId: number, username: string, text: string, replyMsg: any, messageId: number) {
  const isUserAdmin = await isAdmin(chatId, userId);
  const isOwner = isDeveloper(userId);
  
  const { data: group } = await supabase.from('telegram_groups').select('*').eq('chat_id', chatId).single();
  
  const systemPrompt = `أنت فادي، مساعد ذكي لإدارة مجموعات تيليجرام. أنت ودود وذكي ومرح.
تتحدث بالعربية (لهجة مصرية خفيفة).
المستخدم الحالي: ${username} (ID: ${userId})
هل هو مشرف: ${isUserAdmin ? 'نعم' : 'لا'}
هل هو المطور: ${isOwner ? 'نعم' : 'لا'}

${replyMsg ? `الرسالة المردود عليها من: ${replyMsg.from?.first_name || replyMsg.from?.username || 'مجهول'} (ID: ${replyMsg.from?.id})
نص الرسالة المردود عليها: ${replyMsg.text || '(بدون نص)'}` : ''}

إذا طلب المستخدم إجراء إداري (حظر، طرد، كتم، تحذير، ترقية، تخفيض، قفل، فتح) وكان مشرفاً أو المطور:
- أعد الرد بصيغة JSON في نهاية رسالتك هكذا: [ACTION:{"type":"ban/kick/mute/unmute/warn/unwarn/promote/demote/lock_links/unlock_links/lock_media/unlock_media","target_user_id":123}]
- إذا كان يرد على رسالة شخص، استخدم ID الشخص المردود عليه كـ target_user_id
- إذا لم يكن مشرفاً ولا المطور، أخبره بلطف أن هذه الصلاحية للمشرفين فقط

إذا طلب شيء غير إداري (سؤال، محادثة، نكتة، معلومة):
- أجب بشكل طبيعي وودود

لا ترسل JSON إذا لم يطلب إجراء إداري.
كن مختصراً في ردودك (أقل من 200 كلمة).`;

  try {
    const LOVABLE_API_KEY = getEnv('LOVABLE_API_KEY');
    
    const aiResponse = await fetch(AI_GATEWAY_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${LOVABLE_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'google/gemini-2.5-flash',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: text },
        ],
      }),
    });

    if (!aiResponse.ok) {
      if (aiResponse.status === 429) {
        await sendMsg(chatId, '⏳ فادي مشغول شوية، جرب تاني كمان شوية!', undefined, messageId);
        return;
      }
      throw new Error(`AI error: ${aiResponse.status}`);
    }

    const aiData = await aiResponse.json();
    let reply = aiData.choices?.[0]?.message?.content || 'معلش، مش فاهم. جرب تاني! 🤔';

    // Check for admin action in response
    const actionMatch = reply.match(/\[ACTION:(\{.*?\})\]/);
    if (actionMatch) {
      reply = reply.replace(/\[ACTION:\{.*?\}\]/, '').trim();
      
      try {
        const action = JSON.parse(actionMatch[1]);
        const targetId = action.target_user_id || replyMsg?.from?.id;
        
        if (targetId && (isUserAdmin || isOwner)) {
          const targetName = replyMsg?.from?.first_name || replyMsg?.from?.username || String(targetId);
          const targetUsername = replyMsg?.from?.username || replyMsg?.from?.first_name || String(targetId);
          
          switch (action.type) {
            case 'ban':
              await tgCall('banChatMember', { chat_id: chatId, user_id: targetId });
              await supabase.from('telegram_users').update({ is_banned: true }).eq('user_id', targetId).eq('chat_id', chatId);
              await logAction(supabase, chatId, userId, username, targetId, targetUsername, 'ban', 'عبر فادي AI');
              break;
            case 'kick':
              await tgCall('banChatMember', { chat_id: chatId, user_id: targetId });
              await tgCall('unbanChatMember', { chat_id: chatId, user_id: targetId });
              await logAction(supabase, chatId, userId, username, targetId, targetUsername, 'kick', 'عبر فادي AI');
              break;
            case 'mute':
              await tgCall('restrictChatMember', { chat_id: chatId, user_id: targetId, permissions: { can_send_messages: false, can_send_media_messages: false, can_send_other_messages: false } });
              await supabase.from('telegram_users').update({ is_muted: true }).eq('user_id', targetId).eq('chat_id', chatId);
              await logAction(supabase, chatId, userId, username, targetId, targetUsername, 'mute', 'عبر فادي AI');
              break;
            case 'unmute':
              await tgCall('restrictChatMember', { chat_id: chatId, user_id: targetId, permissions: { can_send_messages: true, can_send_media_messages: true, can_send_other_messages: true, can_add_web_page_previews: true } });
              await supabase.from('telegram_users').update({ is_muted: false }).eq('user_id', targetId).eq('chat_id', chatId);
              await logAction(supabase, chatId, userId, username, targetId, targetUsername, 'unmute', 'عبر فادي AI');
              break;
            case 'warn': {
              const { data: user } = await supabase.from('telegram_users').select('warnings').eq('user_id', targetId).eq('chat_id', chatId).single();
              const newW = (user?.warnings || 0) + 1;
              await supabase.from('telegram_users').update({ warnings: newW }).eq('user_id', targetId).eq('chat_id', chatId);
              await logAction(supabase, chatId, userId, username, targetId, targetUsername, 'warn', `تحذير ${newW}/3 عبر فادي AI`);
              if (newW >= 3) {
                await tgCall('banChatMember', { chat_id: chatId, user_id: targetId });
                await tgCall('unbanChatMember', { chat_id: chatId, user_id: targetId });
                reply += `\n\n⚠️ وصل لـ 3 تحذيرات وتم طرده تلقائياً!`;
              }
              break;
            }
            case 'unwarn': {
              const { data: user } = await supabase.from('telegram_users').select('warnings').eq('user_id', targetId).eq('chat_id', chatId).single();
              const newW = Math.max(0, (user?.warnings || 0) - 1);
              await supabase.from('telegram_users').update({ warnings: newW }).eq('user_id', targetId).eq('chat_id', chatId);
              break;
            }
            case 'promote':
              await tgCall('promoteChatMember', { chat_id: chatId, user_id: targetId, can_delete_messages: true, can_restrict_members: true, can_pin_messages: true, can_invite_users: true });
              await logAction(supabase, chatId, userId, username, targetId, targetUsername, 'promote', 'عبر فادي AI');
              break;
            case 'demote':
              await tgCall('promoteChatMember', { chat_id: chatId, user_id: targetId, can_delete_messages: false, can_restrict_members: false, can_pin_messages: false });
              await logAction(supabase, chatId, userId, username, targetId, targetUsername, 'demote', 'عبر فادي AI');
              break;
            case 'lock_links':
              await supabase.from('telegram_groups').update({ lock_links: true }).eq('chat_id', chatId);
              break;
            case 'unlock_links':
              await supabase.from('telegram_groups').update({ lock_links: false }).eq('chat_id', chatId);
              break;
            case 'lock_media':
              await supabase.from('telegram_groups').update({ lock_media: true }).eq('chat_id', chatId);
              break;
            case 'unlock_media':
              await supabase.from('telegram_groups').update({ lock_media: false }).eq('chat_id', chatId);
              break;
          }
        }
      } catch (e) {
        console.error('AI action error:', e);
      }
    }

    if (reply) {
      await sendMsg(chatId, `🤖 <b>فادي:</b>\n${reply}`, undefined, messageId);
    }
  } catch (e) {
    console.error('AI error:', e);
    await sendMsg(chatId, '🤖 فادي مش متاح دلوقتي، جرب تاني! 😅', undefined, messageId);
  }
}

// ==================== JOKES & QUIZ DATA ====================

const jokes = [
  "واحد راح للدكتور قاله عندي مشكلة في عيني.. قاله إيه هي؟ قاله بشوف الناس صغيرة.. قاله طب ابعد عن البلكونة 😂",
  "واحد سأل صاحبه: ليش ما تاكل سمك؟ قاله: لأنه ما سوالي شي 😂",
  "مدرس سأل طالب: وين ولدت؟ قال: في المستشفى. قال: ليش كنت مريض؟ 😂",
  "واحد قال لأبوه: أبي أتزوج.. قاله: أول شي تعلم سباحة.. قاله: ليش؟ قاله: عشان تنقذ نفسك 😂",
  "طفل قال لأمه: ماما أنا ما أبي أروح المدرسة! قالت: ليش؟ قال: الطلاب يكرهوني والمعلمين يكرهوني.. قالت: لازم تروح أنت المدير 😂",
  "واحد دخل صيدلية قال: عندك حاجة للكحة؟ قاله: أيوا.. كح وأنا أقولك 😂",
  "واحد سأل صاحبه: تعرف الفرق بين المدرسة والسجن؟ قاله: في السجن بيخلوك تنام 😂",
  "دكتور قال لمريض: عندك ضغط عالي.. قاله: طبيعي ورايا 3 امتحانات 😂",
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
  { q: "ما هي لغة البرازيل الرسمية؟", options: ["الإسبانية", "البرتغالية", "الإنجليزية", "الفرنسية"], answer: 1 },
  { q: "كم عدد ألوان قوس قزح؟", options: ["5", "6", "7", "8"], answer: 2 },
];

const truths = [
  "ما هو أكثر شيء محرج حصل لك؟",
  "ما هو سرك الذي لا يعرفه أحد؟",
  "من هو الشخص الذي تحبه أكثر في هذه المجموعة؟",
  "ما هو أغرب حلم حلمت به؟",
  "ما هو الشيء الذي تخاف منه؟",
  "ما هو أكثر شيء تندم عليه؟",
  "إيه أكتر حاجة بتعملها في السر؟",
  "مين أكتر شخص بتغير منه؟",
];

const dares = [
  "أرسل رسالة حب لآخر شخص كلمته 😂",
  "غير صورتك الشخصية لمدة ساعة",
  "أرسل رسالة صوتية وأنت تغني",
  "اكتب اسمك بالمقلوب واستخدمه لمدة يوم",
  "أرسل إيموجي واحد فقط لمدة 10 دقائق",
  "اعترف بحاجة مسويها وما قلتها لحد",
  "أرسل صورة أقدم صورة عندك في الجوال",
  "اكتب بوست في المجموعة تمدح فيه أول شخص يرد عليك",
];

const hackMessages = [
  "⚡ جاري الاتصال بالسيرفرات...",
  "🔍 البحث عن الثغرات...",
  "💻 اختراق جدار الحماية...",
  "📡 الوصول لقاعدة البيانات...",
  "📸 تحميل الصور والملفات...",
  "🔓 فك تشفير كلمات المرور...",
  "🎯 تحليل البيانات الشخصية...",
  "☠️ زرع فيروس التجسس...",
];

// ==================== COMMAND HANDLERS ====================

async function handleCommand(supabase: any, update: any) {
  const msg = update.message;
  if (!msg) return;
  
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  const username = msg.from.username || msg.from.first_name || '';
  const text = (msg.text || '').trim();
  const replyMsg = msg.reply_to_message;
  const targetUser = replyMsg?.from;

  // Ensure group and user
  if (msg.chat.type !== 'private') {
    await ensureGroup(supabase, chatId, msg.chat.title);
    await ensureUser(supabase, userId, chatId, msg.from.username, msg.from.first_name, msg.from.last_name);
  }

  // New member welcome + notify developer
  if (msg.new_chat_members) {
    const { data: group } = await supabase.from('telegram_groups').select('welcome_message, title').eq('chat_id', chatId).single();
    const welcome = group?.welcome_message || 'مرحباً بك في المجموعة! 👋';
    const groupTitle = group?.title || msg.chat.title || 'مجموعة';
    
    for (const member of msg.new_chat_members) {
      const name = member.first_name || member.username || 'عضو جديد';
      await sendMsg(chatId, `${welcome}\n\nأهلاً <b>${name}</b>! 🎉`);
      await ensureUser(supabase, member.id, chatId, member.username, member.first_name, member.last_name);
      
      // 🔔 Notify developer about new member
      await notifyDeveloper(
        `🆕 <b>عضو جديد!</b>\n\n` +
        `👤 الاسم: <b>${name}</b>\n` +
        `🔗 المعرف: ${member.username ? `@${member.username}` : 'بدون'}\n` +
        `🆔 ID: <code>${member.id}</code>\n` +
        `💬 المجموعة: <b>${groupTitle}</b>\n` +
        `📅 الوقت: ${new Date().toLocaleString('ar')}`
      );
    }
    return;
  }

  // Left member notify
  if (msg.left_chat_member) {
    const member = msg.left_chat_member;
    const name = member.first_name || member.username || 'عضو';
    const groupTitle = msg.chat.title || 'مجموعة';
    await notifyDeveloper(
      `🚪 <b>عضو غادر!</b>\n\n` +
      `👤 الاسم: <b>${name}</b>\n` +
      `🔗 المعرف: ${member.username ? `@${member.username}` : 'بدون'}\n` +
      `💬 المجموعة: <b>${groupTitle}</b>`
    );
    return;
  }

  // Check spam / links / media / stickers / files locks
  if (msg.chat.type !== 'private') {
    const { data: group } = await supabase.from('telegram_groups').select('*').eq('chat_id', chatId).single();
    if (group) {
      const admin = await isAdmin(chatId, userId);
      const dev = isDeveloper(userId);
      
      if (group.lock_links && !admin && !dev && msg.entities?.some((e: any) => e.type === 'url' || e.type === 'text_link')) {
        try { await tgCall('deleteMessage', { chat_id: chatId, message_id: msg.message_id }); } catch {}
        await sendMsg(chatId, `⚠️ @${username} الروابط ممنوعة في هذه المجموعة!`);
        return;
      }
      if (group.lock_media && !admin && !dev && (msg.photo || msg.video || msg.animation || msg.document?.mime_type?.startsWith('video'))) {
        try { await tgCall('deleteMessage', { chat_id: chatId, message_id: msg.message_id }); } catch {}
        await sendMsg(chatId, `⚠️ @${username} الوسائط ممنوعة في هذه المجموعة!`);
        return;
      }
      if (group.lock_stickers && !admin && !dev && msg.sticker) {
        try { await tgCall('deleteMessage', { chat_id: chatId, message_id: msg.message_id }); } catch {}
        await sendMsg(chatId, `⚠️ @${username} الملصقات ممنوعة في هذه المجموعة!`);
        return;
      }
      if (group.lock_files && !admin && !dev && msg.document) {
        try { await tgCall('deleteMessage', { chat_id: chatId, message_id: msg.message_id }); } catch {}
        await sendMsg(chatId, `⚠️ @${username} الملفات ممنوعة في هذه المجموعة!`);
        return;
      }
    }
  }

  // Check if message mentions "فادي" for AI
  const fadiMentioned = text.includes('فادي') || text.includes('يا فادي') || text.includes('Fadi') || text.includes('fadi');
  
  if (fadiMentioned && msg.chat.type !== 'private') {
    await handleAI(supabase, chatId, userId, username, text, replyMsg, msg.message_id);
    return;
  }

  // Commands
  if (!text.startsWith('/')) {
    if (msg.chat.type !== 'private') {
      await supabase.rpc('increment_points', { p_user_id: userId, p_chat_id: chatId }).catch(() => {});
    }
    return;
  }

  const [cmd, ...args] = text.split(/\s+/);
  const botInfo = await tgCall('getMe', {}).catch(() => ({ result: { username: '' } }));
  const botUsername = botInfo.result?.username?.toLowerCase() || '';
  const command = cmd.toLowerCase().replace(`@${botUsername}`, '');

  switch (command) {
    case '/start':
      if (msg.chat.type === 'private') {
        if (args[0]?.startsWith('whisper_')) break;
        await sendMsg(chatId, `🤖 <b>مرحباً! أنا بوت إدارة المجموعات</b>\n\n✨ أقدر أساعدك في إدارة مجموعتك بالكامل\n\n🧠 يمكنك التحدث مع <b>فادي</b> (الذكاء الاصطناعي) في المجموعة بذكر اسمه\n\nمثال: "يا فادي احظر هذا الشخص"\n\n📋 اكتب /help لعرض جميع الأوامر`, {
          inline_keyboard: [
            [{ text: '👨‍💻 المطور', url: `tg://user?id=${DEVELOPER_ID}` }],
            [{ text: '➕ أضفني لمجموعتك', url: `https://t.me/${botUsername}?startgroup=true` }],
          ],
        });
      } else {
        await sendMsg(chatId, `🤖 <b>مرحباً! أنا بوت إدارة المجموعات</b>\n\n🧠 تكلم مع <b>فادي</b> للإدارة بالذكاء الاصطناعي\n📋 اكتب /help للأوامر`, {
          inline_keyboard: [
            [{ text: '👨‍💻 المطور', url: `tg://user?id=${DEVELOPER_ID}` }],
          ],
        });
      }
      break;

    case '/help':
      await sendMsg(chatId, `📋 <b>قائمة الأوامر الكاملة:</b>\n\n🤖 <b>الذكاء الاصطناعي:</b>\nاذكر "فادي" في رسالتك وهو هيفهم ويتصرف\nمثال: "يا فادي احظر" | "يا فادي نكتة"\n\n👑 <b>الإدارة:</b>\n/ban - حظر عضو (بالرد)\n/unban - إلغاء حظر\n/kick - طرد عضو\n/mute - كتم عضو\n/unmute - إلغاء كتم\n/warn - تحذير (3 = طرد)\n/unwarn - إزالة تحذير\n/promote - ترقية لمشرف\n/demote - تخفيض مشرف\n\n🔒 <b>الحماية:</b>\n/lock links|media|stickers|files\n/unlock links|media|stickers|files\n/antispam on|off\n/setwelcome - رسالة ترحيب\n\n📢 <b>النداء:</b>\n/tagall - نداء جميع الأعضاء\n/all - نداء سريع\n\n🎮 <b>الترفيه:</b>\n/quiz - أسئلة\n/game - تخمين رقم\n/truth - حقيقة\n/dare - تحدي\n/joke - نكتة\n/hack - اختراق وهمي\n/whisper - همسة\n/points - نقاطك\n/top - أعلى النقاط\n/random - عضو عشوائي\n/roll - رمي نرد\n/flip - قلب عملة\n\nℹ️ <b>معلومات:</b>\n/id - معرفك\n/info - معلومات عضو\n/rules - قوانين المجموعة\n/setrules - تعيين القوانين\n/report - إبلاغ عن مخالفة\n/pin - تثبيت رسالة\n/unpin - إلغاء تثبيت\n/dev - التواصل مع المطور`, {
        inline_keyboard: [[{ text: '👨‍💻 المطور', url: `tg://user?id=${DEVELOPER_ID}` }]],
      });
      break;

    case '/dev':
    case '/developer':
    case '/owner':
      await sendMsg(chatId, `👨‍💻 <b>المطور:</b>\n\nللتواصل مع مطور البوت:`, {
        inline_keyboard: [[{ text: '💬 تواصل مع المطور', url: `tg://user?id=${DEVELOPER_ID}` }]],
      });
      break;

    case '/id':
      if (targetUser) {
        await sendMsg(chatId, `🆔 معرف <b>${targetUser.first_name || targetUser.username}</b>: <code>${targetUser.id}</code>`);
      } else {
        await sendMsg(chatId, `🆔 معرفك: <code>${userId}</code>\n💬 معرف المجموعة: <code>${chatId}</code>`);
      }
      break;

    case '/info':
      {
        const infoTarget = targetUser || msg.from;
        const { data: userData } = await supabase.from('telegram_users').select('*').eq('user_id', infoTarget.id).eq('chat_id', chatId).single();
        const memberData = await tgCall('getChatMember', { chat_id: chatId, user_id: infoTarget.id }).catch(() => null);
        
        await sendMsg(chatId, `📊 <b>معلومات العضو:</b>\n\n👤 الاسم: <b>${infoTarget.first_name || ''} ${infoTarget.last_name || ''}</b>\n🔗 المعرف: @${infoTarget.username || 'بدون'}\n🆔 ID: <code>${infoTarget.id}</code>\n📊 المنصب: ${memberData?.result?.status === 'creator' ? '👑 مالك' : memberData?.result?.status === 'administrator' ? '⭐ مشرف' : '👤 عضو'}\n🏆 النقاط: ${userData?.points || 0}\n⭐ المستوى: ${userData?.level || 1}\n⚠️ التحذيرات: ${userData?.warnings || 0}/3\n${userData?.is_banned ? '🚫 محظور' : ''}${userData?.is_muted ? '🔇 مكتوم' : ''}`);
      }
      break;

    case '/tagall':
    case '/all':
    case '/everyone':
      if (!(await isAdmin(chatId, userId)) && !isDeveloper(userId)) {
        await sendMsg(chatId, '❌ هذا الأمر للمشرفين فقط');
        break;
      }
      await tagAllMembers(supabase, chatId, username);
      break;

    case '/ban':
      if (!targetUser) { await sendMsg(chatId, '❌ قم بالرد على رسالة العضو المراد حظره'); break; }
      if (!(await isAdmin(chatId, userId)) && !isDeveloper(userId)) { await sendMsg(chatId, '❌ هذا الأمر للمشرفين فقط'); break; }
      try {
        await tgCall('banChatMember', { chat_id: chatId, user_id: targetUser.id });
        await supabase.from('telegram_users').update({ is_banned: true }).eq('user_id', targetUser.id).eq('chat_id', chatId);
        await logAction(supabase, chatId, userId, username, targetUser.id, targetUser.username || targetUser.first_name, 'ban');
        await sendMsg(chatId, `🚫 تم حظر <b>${targetUser.first_name || targetUser.username}</b> بواسطة <b>${username}</b>`);
      } catch (e) { await sendMsg(chatId, '❌ فشل الحظر. تأكد من صلاحيات البوت'); }
      break;

    case '/unban':
      if (!targetUser) { await sendMsg(chatId, '❌ قم بالرد على رسالة العضو'); break; }
      if (!(await isAdmin(chatId, userId)) && !isDeveloper(userId)) { await sendMsg(chatId, '❌ هذا الأمر للمشرفين فقط'); break; }
      try {
        await tgCall('unbanChatMember', { chat_id: chatId, user_id: targetUser.id, only_if_banned: true });
        await supabase.from('telegram_users').update({ is_banned: false }).eq('user_id', targetUser.id).eq('chat_id', chatId);
        await logAction(supabase, chatId, userId, username, targetUser.id, targetUser.username || targetUser.first_name, 'unban');
        await sendMsg(chatId, `✅ تم إلغاء حظر <b>${targetUser.first_name || targetUser.username}</b>`);
      } catch { await sendMsg(chatId, '❌ فشلت العملية'); }
      break;

    case '/kick':
      if (!targetUser) { await sendMsg(chatId, '❌ قم بالرد على رسالة العضو'); break; }
      if (!(await isAdmin(chatId, userId)) && !isDeveloper(userId)) { await sendMsg(chatId, '❌ هذا الأمر للمشرفين فقط'); break; }
      try {
        await tgCall('banChatMember', { chat_id: chatId, user_id: targetUser.id });
        await tgCall('unbanChatMember', { chat_id: chatId, user_id: targetUser.id });
        await logAction(supabase, chatId, userId, username, targetUser.id, targetUser.username || targetUser.first_name, 'kick');
        await sendMsg(chatId, `👢 تم طرد <b>${targetUser.first_name || targetUser.username}</b> بواسطة <b>${username}</b>`);
      } catch { await sendMsg(chatId, '❌ فشل الطرد'); }
      break;

    case '/mute':
      if (!targetUser) { await sendMsg(chatId, '❌ قم بالرد على رسالة العضو'); break; }
      if (!(await isAdmin(chatId, userId)) && !isDeveloper(userId)) { await sendMsg(chatId, '❌ هذا الأمر للمشرفين فقط'); break; }
      try {
        await tgCall('restrictChatMember', {
          chat_id: chatId, user_id: targetUser.id,
          permissions: { can_send_messages: false, can_send_media_messages: false, can_send_other_messages: false },
        });
        await supabase.from('telegram_users').update({ is_muted: true }).eq('user_id', targetUser.id).eq('chat_id', chatId);
        await logAction(supabase, chatId, userId, username, targetUser.id, targetUser.username || targetUser.first_name, 'mute');
        await sendMsg(chatId, `🔇 تم كتم <b>${targetUser.first_name || targetUser.username}</b>`);
      } catch { await sendMsg(chatId, '❌ فشل الكتم'); }
      break;

    case '/unmute':
      if (!targetUser) { await sendMsg(chatId, '❌ قم بالرد على رسالة العضو'); break; }
      if (!(await isAdmin(chatId, userId)) && !isDeveloper(userId)) { await sendMsg(chatId, '❌ هذا الأمر للمشرفين فقط'); break; }
      try {
        await tgCall('restrictChatMember', {
          chat_id: chatId, user_id: targetUser.id,
          permissions: { can_send_messages: true, can_send_media_messages: true, can_send_other_messages: true, can_add_web_page_previews: true },
        });
        await supabase.from('telegram_users').update({ is_muted: false }).eq('user_id', targetUser.id).eq('chat_id', chatId);
        await logAction(supabase, chatId, userId, username, targetUser.id, targetUser.username || targetUser.first_name, 'unmute');
        await sendMsg(chatId, `🔊 تم إلغاء كتم <b>${targetUser.first_name || targetUser.username}</b>`);
      } catch { await sendMsg(chatId, '❌ فشلت العملية'); }
      break;

    case '/warn':
      if (!targetUser) { await sendMsg(chatId, '❌ قم بالرد على رسالة العضو'); break; }
      if (!(await isAdmin(chatId, userId)) && !isDeveloper(userId)) { await sendMsg(chatId, '❌ هذا الأمر للمشرفين فقط'); break; }
      {
        const { data: user } = await supabase.from('telegram_users').select('warnings').eq('user_id', targetUser.id).eq('chat_id', chatId).single();
        const newWarnings = (user?.warnings || 0) + 1;
        await supabase.from('telegram_users').update({ warnings: newWarnings }).eq('user_id', targetUser.id).eq('chat_id', chatId);
        await logAction(supabase, chatId, userId, username, targetUser.id, targetUser.username || targetUser.first_name, 'warn', `تحذير ${newWarnings}/3`);
        
        if (newWarnings >= 3) {
          try {
            await tgCall('banChatMember', { chat_id: chatId, user_id: targetUser.id });
            await tgCall('unbanChatMember', { chat_id: chatId, user_id: targetUser.id });
            await sendMsg(chatId, `⚠️ <b>${targetUser.first_name || targetUser.username}</b> حصل على 3 تحذيرات وتم طرده تلقائياً!`);
          } catch {}
        } else {
          await sendMsg(chatId, `⚠️ تحذير لـ <b>${targetUser.first_name || targetUser.username}</b> (${newWarnings}/3)`);
        }
      }
      break;

    case '/unwarn':
      if (!targetUser) { await sendMsg(chatId, '❌ قم بالرد على رسالة العضو'); break; }
      if (!(await isAdmin(chatId, userId)) && !isDeveloper(userId)) { await sendMsg(chatId, '❌ هذا الأمر للمشرفين فقط'); break; }
      {
        const { data: user } = await supabase.from('telegram_users').select('warnings').eq('user_id', targetUser.id).eq('chat_id', chatId).single();
        const newW = Math.max(0, (user?.warnings || 0) - 1);
        await supabase.from('telegram_users').update({ warnings: newW }).eq('user_id', targetUser.id).eq('chat_id', chatId);
        await sendMsg(chatId, `✅ تم إزالة تحذير من <b>${targetUser.first_name || targetUser.username}</b> (${newW}/3)`);
      }
      break;

    case '/promote':
      if (!targetUser) { await sendMsg(chatId, '❌ قم بالرد على رسالة العضو'); break; }
      if (!(await isAdmin(chatId, userId)) && !isDeveloper(userId)) { await sendMsg(chatId, '❌ هذا الأمر للمشرفين فقط'); break; }
      try {
        await tgCall('promoteChatMember', {
          chat_id: chatId, user_id: targetUser.id,
          can_delete_messages: true, can_restrict_members: true, can_pin_messages: true, can_invite_users: true,
        });
        await logAction(supabase, chatId, userId, username, targetUser.id, targetUser.username || targetUser.first_name, 'promote');
        await sendMsg(chatId, `⬆️ تم ترقية <b>${targetUser.first_name || targetUser.username}</b> لمشرف ⭐`);
      } catch { await sendMsg(chatId, '❌ فشلت الترقية'); }
      break;

    case '/demote':
      if (!targetUser) { await sendMsg(chatId, '❌ قم بالرد على رسالة العضو'); break; }
      if (!(await isAdmin(chatId, userId)) && !isDeveloper(userId)) { await sendMsg(chatId, '❌ هذا الأمر للمشرفين فقط'); break; }
      try {
        await tgCall('promoteChatMember', {
          chat_id: chatId, user_id: targetUser.id,
          can_delete_messages: false, can_restrict_members: false, can_pin_messages: false,
        });
        await logAction(supabase, chatId, userId, username, targetUser.id, targetUser.username || targetUser.first_name, 'demote');
        await sendMsg(chatId, `⬇️ تم تخفيض <b>${targetUser.first_name || targetUser.username}</b>`);
      } catch { await sendMsg(chatId, '❌ فشلت العملية'); }
      break;

    case '/lock':
      if (!(await isAdmin(chatId, userId)) && !isDeveloper(userId)) { await sendMsg(chatId, '❌ هذا الأمر للمشرفين فقط'); break; }
      switch (args[0]) {
        case 'links': await supabase.from('telegram_groups').update({ lock_links: true }).eq('chat_id', chatId); await sendMsg(chatId, '🔒 تم قفل الروابط'); break;
        case 'media': await supabase.from('telegram_groups').update({ lock_media: true }).eq('chat_id', chatId); await sendMsg(chatId, '🔒 تم قفل الوسائط'); break;
        case 'stickers': await supabase.from('telegram_groups').update({ lock_stickers: true }).eq('chat_id', chatId); await sendMsg(chatId, '🔒 تم قفل الملصقات'); break;
        case 'files': await supabase.from('telegram_groups').update({ lock_files: true }).eq('chat_id', chatId); await sendMsg(chatId, '🔒 تم قفل الملفات'); break;
        default: await sendMsg(chatId, '❌ استخدم: /lock links|media|stickers|files'); break;
      }
      break;

    case '/unlock':
      if (!(await isAdmin(chatId, userId)) && !isDeveloper(userId)) { await sendMsg(chatId, '❌ هذا الأمر للمشرفين فقط'); break; }
      switch (args[0]) {
        case 'links': await supabase.from('telegram_groups').update({ lock_links: false }).eq('chat_id', chatId); await sendMsg(chatId, '🔓 تم فتح الروابط'); break;
        case 'media': await supabase.from('telegram_groups').update({ lock_media: false }).eq('chat_id', chatId); await sendMsg(chatId, '🔓 تم فتح الوسائط'); break;
        case 'stickers': await supabase.from('telegram_groups').update({ lock_stickers: false }).eq('chat_id', chatId); await sendMsg(chatId, '🔓 تم فتح الملصقات'); break;
        case 'files': await supabase.from('telegram_groups').update({ lock_files: false }).eq('chat_id', chatId); await sendMsg(chatId, '🔓 تم فتح الملفات'); break;
        default: await sendMsg(chatId, '❌ استخدم: /unlock links|media|stickers|files'); break;
      }
      break;

    case '/antispam':
      if (!(await isAdmin(chatId, userId)) && !isDeveloper(userId)) { await sendMsg(chatId, '❌ هذا الأمر للمشرفين فقط'); break; }
      if (args[0] === 'on') {
        await supabase.from('telegram_groups').update({ anti_spam: true }).eq('chat_id', chatId);
        await sendMsg(chatId, '🛡 تم تفعيل مضاد السبام');
      } else if (args[0] === 'off') {
        await supabase.from('telegram_groups').update({ anti_spam: false }).eq('chat_id', chatId);
        await sendMsg(chatId, '🛡 تم إيقاف مضاد السبام');
      } else {
        await sendMsg(chatId, '❌ استخدم: /antispam on أو /antispam off');
      }
      break;

    case '/setwelcome':
      if (!(await isAdmin(chatId, userId)) && !isDeveloper(userId)) { await sendMsg(chatId, '❌ هذا الأمر للمشرفين فقط'); break; }
      {
        const welcomeText = args.join(' ');
        if (!welcomeText) { await sendMsg(chatId, '❌ اكتب رسالة الترحيب بعد الأمر'); break; }
        await supabase.from('telegram_groups').update({ welcome_message: welcomeText }).eq('chat_id', chatId);
        await sendMsg(chatId, `✅ تم تعيين رسالة الترحيب:\n${welcomeText}`);
      }
      break;

    case '/pin':
      if (!replyMsg) { await sendMsg(chatId, '❌ قم بالرد على الرسالة المراد تثبيتها'); break; }
      if (!(await isAdmin(chatId, userId)) && !isDeveloper(userId)) { await sendMsg(chatId, '❌ هذا الأمر للمشرفين فقط'); break; }
      try {
        await tgCall('pinChatMessage', { chat_id: chatId, message_id: replyMsg.message_id });
        await sendMsg(chatId, '📌 تم تثبيت الرسالة');
      } catch { await sendMsg(chatId, '❌ فشل التثبيت'); }
      break;

    case '/unpin':
      if (!(await isAdmin(chatId, userId)) && !isDeveloper(userId)) { await sendMsg(chatId, '❌ هذا الأمر للمشرفين فقط'); break; }
      try {
        if (replyMsg) {
          await tgCall('unpinChatMessage', { chat_id: chatId, message_id: replyMsg.message_id });
        } else {
          await tgCall('unpinAllChatMessages', { chat_id: chatId });
        }
        await sendMsg(chatId, '📌 تم إلغاء التثبيت');
      } catch { await sendMsg(chatId, '❌ فشلت العملية'); }
      break;

    case '/report':
      if (!targetUser) { await sendMsg(chatId, '❌ قم بالرد على رسالة المخالف للإبلاغ عنه'); break; }
      {
        await sendMsg(chatId, `🚨 <b>بلاغ جديد!</b>\n\nمن: <b>${username}</b>\nضد: <b>${targetUser.first_name || targetUser.username}</b>\nالسبب: ${args.join(' ') || 'غير محدد'}\n\n⚠️ تم إخطار المشرفين`);
        await logAction(supabase, chatId, userId, username, targetUser.id, targetUser.username || targetUser.first_name, 'report', args.join(' ') || 'بدون سبب');
      }
      break;

    case '/top': {
      const { data: topUsers } = await supabase.from('telegram_users').select('*').eq('chat_id', chatId).order('points', { ascending: false }).limit(10);
      if (topUsers && topUsers.length > 0) {
        const medals = ['🥇', '🥈', '🥉'];
        const list = topUsers.map((u: any, i: number) => `${medals[i] || `${i + 1}.`} <b>${u.first_name || u.username || u.user_id}</b> - ${u.points} نقطة (مستوى ${u.level})`).join('\n');
        await sendMsg(chatId, `🏆 <b>أعلى 10 أعضاء نشاطاً:</b>\n\n${list}`);
      } else {
        await sendMsg(chatId, '❌ لا توجد بيانات أعضاء بعد');
      }
      break;
    }

    case '/roll':
      {
        const dice = Math.floor(Math.random() * 6) + 1;
        const diceEmoji = ['⚀', '⚁', '⚂', '⚃', '⚄', '⚅'];
        await sendMsg(chatId, `🎲 ${diceEmoji[dice - 1]} رمى <b>${username}</b> النرد وحصل على: <b>${dice}</b>`);
      }
      break;

    case '/flip':
      {
        const result = Math.random() > 0.5 ? 'صورة 🪙' : 'كتابة ✍️';
        await sendMsg(chatId, `🪙 قلب <b>${username}</b> العملة والنتيجة: <b>${result}</b>`);
      }
      break;

    case '/quiz': {
      const quiz = quizzes[Math.floor(Math.random() * quizzes.length)];
      const buttons = quiz.options.map((opt, i) => [{ text: opt, callback_data: `quiz_${i}_${quiz.answer}` }]);
      await sendMsg(chatId, `❓ <b>${quiz.q}</b>`, { inline_keyboard: buttons });
      break;
    }

    case '/game':
      {
        const num = Math.floor(Math.random() * 10) + 1;
        await sendMsg(chatId, `🎮 <b>لعبة تخمين الرقم!</b>\n\nاخترت رقماً من 1 إلى 10\nخمن الرقم!`, {
          inline_keyboard: Array.from({ length: 10 }, (_, i) => [{ text: `${i + 1}`, callback_data: `game_${i + 1}_${num}` }]).reduce((rows: any[], btn, i) => {
            if (i % 5 === 0) rows.push([]);
            rows[rows.length - 1].push(btn[0]);
            return rows;
          }, []),
        });
      }
      break;

    case '/truth':
      await sendMsg(chatId, `🤔 <b>حقيقة:</b>\n\n${truths[Math.floor(Math.random() * truths.length)]}`);
      break;

    case '/dare':
      await sendMsg(chatId, `🔥 <b>تحدي:</b>\n\n${dares[Math.floor(Math.random() * dares.length)]}`);
      break;

    case '/joke':
      await sendMsg(chatId, `😂 <b>نكتة:</b>\n\n${jokes[Math.floor(Math.random() * jokes.length)]}`);
      break;

    case '/hack':
      if (!targetUser) { await sendMsg(chatId, '❌ قم بالرد على رسالة العضو المراد "اختراقه" 😈'); break; }
      {
        const name = targetUser.first_name || targetUser.username || 'المستهدف';
        let msgId: number | null = null;
        for (let i = 0; i < hackMessages.length; i++) {
          await new Promise(r => setTimeout(r, 1200));
          if (i === 0) {
            const res = await sendMsg(chatId, `🎯 <b>هدف الاختراق: ${name}</b>\n\n${hackMessages[i]}`);
            msgId = res.result?.message_id;
          } else if (msgId) {
            try {
              await tgCall('editMessageText', {
                chat_id: chatId,
                message_id: msgId,
                text: `🎯 <b>هدف الاختراق: ${name}</b>\n\n${hackMessages.slice(0, i + 1).join('\n')}${i === hackMessages.length - 1 ? `\n\n✅ <b>تم الاختراق بنجاح!</b>\n😂 مجرد مزحة يا ${name}!` : ''}`,
                parse_mode: 'HTML',
              });
            } catch {}
          }
        }
      }
      break;

    case '/whisper':
      if (!targetUser) { await sendMsg(chatId, '❌ قم بالرد على رسالة الشخص الذي تريد إرسال همسة له'); break; }
      if (msg.chat.type === 'private') { await sendMsg(chatId, '❌ الهمسات تعمل في المجموعات فقط'); break; }
      {
        const whisperId = crypto.randomUUID();
        await supabase.from('telegram_whispers').insert({
          id: whisperId,
          chat_id: chatId,
          from_user_id: userId,
          from_username: username,
          to_user_id: targetUser.id,
          to_username: targetUser.username || targetUser.first_name || '',
          message: args.join(' ') || '(في انتظار الرسالة)',
        });

        if (args.length > 0) {
          await sendMsg(chatId, `💌 <b>${username}</b> أرسل همسة لـ <b>${targetUser.first_name || targetUser.username}</b>`, {
            inline_keyboard: [[{ text: '👁 عرض الهمسة', callback_data: `whisper_${whisperId}_${targetUser.id}` }]],
          });
        } else {
          const botMe = await tgCall('getMe', {});
          await sendMsg(chatId, `💌 <b>${username}</b> يريد إرسال همسة لـ <b>${targetUser.first_name || targetUser.username}</b>\n\n@${username} أرسل الرسالة للبوت في الخاص`, {
            inline_keyboard: [[{ text: '📩 إرسال همسة للبوت', url: `https://t.me/${botMe.result.username}?start=whisper_${whisperId}` }]],
          });
        }
      }
      break;

    case '/points': {
      const { data: user } = await supabase.from('telegram_users').select('points, level').eq('user_id', userId).eq('chat_id', chatId).single();
      if (user) {
        const levelEmojis = ['🌱', '🌿', '🌳', '⭐', '🏆'];
        await sendMsg(chatId, `🏆 <b>إحصائياتك:</b>\n\n💰 النقاط: <b>${user.points}</b>\n${levelEmojis[Math.min(user.level - 1, 4)]} المستوى: <b>${user.level}</b>\n\nاستمر في النشاط لزيادة نقاطك! 🚀`);
      } else {
        await sendMsg(chatId, '❌ لم يتم العثور على بياناتك');
      }
      break;
    }

    case '/random': {
      const { data: rmembers } = await supabase.from('telegram_users').select('*').eq('chat_id', chatId).eq('is_banned', false);
      if (rmembers && rmembers.length > 0) {
        const random = rmembers[Math.floor(Math.random() * rmembers.length)];
        const name = random.first_name || random.username || random.user_id;
        await sendMsg(chatId, `🎲 <b>العضو العشوائي:</b>\n\n🎯 <a href="tg://user?id=${random.user_id}">${name}</a> 🎉`);
      } else {
        await sendMsg(chatId, '❌ لا يوجد أعضاء');
      }
      break;
    }
  }
}

// ==================== CALLBACK QUERY HANDLER ====================

async function handleCallback(supabase: any, callbackQuery: any) {
  const data = callbackQuery.data;
  const userId = callbackQuery.from.id;
  const chatId = callbackQuery.message?.chat.id;

  if (data.startsWith('quiz_')) {
    const [, selected, correct] = data.split('_');
    if (selected === correct) {
      await supabase.rpc('increment_points', { p_user_id: userId, p_chat_id: chatId }).catch(() => {});
      await tgCall('answerCallbackQuery', { callback_query_id: callbackQuery.id, text: '✅ إجابة صحيحة! +10 نقاط 🎉', show_alert: true });
    } else {
      await tgCall('answerCallbackQuery', { callback_query_id: callbackQuery.id, text: '❌ إجابة خاطئة! حاول مرة أخرى', show_alert: true });
    }
  } else if (data.startsWith('game_')) {
    const [, guess, answer] = data.split('_');
    if (guess === answer) {
      await supabase.rpc('increment_points', { p_user_id: userId, p_chat_id: chatId }).catch(() => {});
      await tgCall('answerCallbackQuery', { callback_query_id: callbackQuery.id, text: `🎉 أحسنت! الرقم هو ${answer}! +10 نقاط`, show_alert: true });
    } else {
      await tgCall('answerCallbackQuery', { callback_query_id: callbackQuery.id, text: `❌ خطأ! الرقم كان ${answer}`, show_alert: true });
    }
  } else if (data.startsWith('whisper_')) {
    const [, whisperId, targetId] = data.split('_');
    if (String(userId) !== targetId) {
      await tgCall('answerCallbackQuery', { callback_query_id: callbackQuery.id, text: '❌ هذه الهمسة ليست لك!', show_alert: true });
      return;
    }
    const { data: whisper } = await supabase.from('telegram_whispers').select('message, from_username').eq('id', whisperId).single();
    if (whisper) {
      await tgCall('answerCallbackQuery', { callback_query_id: callbackQuery.id, text: `💌 من ${whisper.from_username}:\n${whisper.message}`, show_alert: true });
      await supabase.from('telegram_whispers').update({ is_read: true }).eq('id', whisperId);
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

    const { data: state, error: stateErr } = await supabase
      .from('telegram_bot_state')
      .select('update_offset')
      .eq('id', 1)
      .single();

    if (stateErr) {
      return new Response(JSON.stringify({ error: stateErr.message }), { status: 500, headers: corsHeaders });
    }

    let currentOffset = state.update_offset;

    while (true) {
      const elapsed = Date.now() - startTime;
      const remainingMs = MAX_RUNTIME_MS - elapsed;
      if (remainingMs < MIN_REMAINING_MS) break;

      const timeout = Math.min(50, Math.floor(remainingMs / 1000) - 5);
      if (timeout < 1) break;

      const response = await fetch(`${GATEWAY_URL}/getUpdates`, {
        method: 'POST',
        headers: getHeaders(),
        body: JSON.stringify({
          offset: currentOffset,
          timeout,
          allowed_updates: ['message', 'callback_query'],
        }),
      });

      const data = await response.json();
      if (!response.ok) {
        return new Response(JSON.stringify({ error: data }), { status: 502, headers: corsHeaders });
      }

      const updates = data.result ?? [];
      if (updates.length === 0) continue;

      const msgRows = updates
        .filter((u: any) => u.message)
        .map((u: any) => ({
          update_id: u.update_id,
          chat_id: u.message.chat.id,
          user_id: u.message.from?.id || null,
          username: u.message.from?.username || null,
          text: u.message.text ?? null,
          raw_update: u,
        }));

      if (msgRows.length > 0) {
        await supabase.from('telegram_messages').upsert(msgRows, { onConflict: 'update_id' });
      }

      for (const update of updates) {
        try {
          if (update.message) await handleCommand(supabase, update);
          if (update.callback_query) await handleCallback(supabase, update);
        } catch (e) {
          console.error('Error processing update:', e);
        }
      }

      totalProcessed += updates.length;

      const newOffset = Math.max(...updates.map((u: any) => u.update_id)) + 1;
      await supabase.from('telegram_bot_state')
        .update({ update_offset: newOffset, updated_at: new Date().toISOString() })
        .eq('id', 1);

      currentOffset = newOffset;
    }

    return new Response(JSON.stringify({ ok: true, processed: totalProcessed, finalOffset: currentOffset }), { headers: corsHeaders });
  } catch (error) {
    console.error('Poll error:', error);
    const msg = error instanceof Error ? error.message : 'Unknown error';
    return new Response(JSON.stringify({ error: msg }), { status: 500, headers: corsHeaders });
  }
});
