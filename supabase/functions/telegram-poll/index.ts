import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const GATEWAY_URL = 'https://connector-gateway.lovable.dev/telegram';

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

async function sendMsg(chatId: number, text: string, replyMarkup?: any) {
  return tgCall('sendMessage', {
    chat_id: chatId,
    text,
    parse_mode: 'HTML',
    ...(replyMarkup ? { reply_markup: replyMarkup } : {}),
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

// ==================== JOKES & QUIZ DATA ====================

const jokes = [
  "واحد راح للدكتور قاله عندي مشكلة في عيني.. قاله إيه هي؟ قاله بشوف الناس صغيرة.. قاله طب ابعد عن البلكونة 😂",
  "واحد سأل صاحبه: ليش ما تاكل سمك؟ قاله: لأنه ما سوالي شي 😂",
  "مدرس سأل طالب: وين ولدت؟ قال: في المستشفى. قال: ليش كنت مريض؟ 😂",
  "واحد قال لأبوه: أبي أتزوج.. قاله: أول شي تعلم سباحة.. قاله: ليش؟ قاله: عشان تنقذ نفسك 😂",
  "طفل قال لأمه: ماما أنا ما أبي أروح المدرسة! قالت: ليش؟ قال: الطلاب يكرهوني والمعلمين يكرهوني.. قالت: لازم تروح أنت المدير 😂",
];

const quizzes = [
  { q: "ما هي عاصمة فرنسا؟", options: ["لندن", "باريس", "برلين", "مدريد"], answer: 1 },
  { q: "كم عدد قارات العالم؟", options: ["5", "6", "7", "8"], answer: 2 },
  { q: "ما هو أكبر كوكب في المجموعة الشمسية؟", options: ["زحل", "المشتري", "أورانوس", "نبتون"], answer: 1 },
  { q: "في أي عام هبط الإنسان على القمر؟", options: ["1965", "1969", "1971", "1975"], answer: 1 },
  { q: "ما هي أطول نهر في العالم؟", options: ["النيل", "الأمازون", "المسيسيبي", "اليانغتسي"], answer: 0 },
];

const truths = [
  "ما هو أكثر شيء محرج حصل لك؟",
  "ما هو سرك الذي لا يعرفه أحد؟",
  "من هو الشخص الذي تحبه أكثر في هذه المجموعة؟",
  "ما هو أغرب حلم حلمت به؟",
  "ما هو الشيء الذي تخاف منه؟",
];

const dares = [
  "أرسل رسالة حب لآخر شخص كلمته 😂",
  "غير صورتك الشخصية لمدة ساعة",
  "أرسل رسالة صوتية وأنت تغني",
  "اكتب اسمك بالمقلوب واستخدمه لمدة يوم",
  "أرسل إيموجي واحد فقط لمدة 10 دقائق",
];

const hackMessages = [
  "⚡ جاري الاتصال بالسيرفرات...",
  "🔍 البحث عن الثغرات...",
  "💻 اختراق جدار الحماية...",
  "📡 الوصول لقاعدة البيانات...",
  "📸 تحميل الصور والملفات...",
  "🔓 فك تشفير كلمات المرور...",
];

// ==================== COMMAND HANDLERS ====================

async function handleCommand(supabase: any, update: any) {
  const msg = update.message;
  if (!msg?.text) return;
  
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  const username = msg.from.username || msg.from.first_name || '';
  const text = msg.text.trim();
  const replyMsg = msg.reply_to_message;
  const targetUser = replyMsg?.from;

  // Ensure group and user
  if (msg.chat.type !== 'private') {
    await ensureGroup(supabase, chatId, msg.chat.title);
    await ensureUser(supabase, userId, chatId, msg.from.username, msg.from.first_name, msg.from.last_name);
  }

  // New member welcome
  if (msg.new_chat_members) {
    const { data: group } = await supabase.from('telegram_groups').select('welcome_message').eq('chat_id', chatId).single();
    const welcome = group?.welcome_message || 'مرحباً بك في المجموعة! 👋';
    for (const member of msg.new_chat_members) {
      const name = member.first_name || member.username || 'عضو جديد';
      await sendMsg(chatId, `${welcome}\n\nأهلاً <b>${name}</b>! 🎉`);
      await ensureUser(supabase, member.id, chatId, member.username, member.first_name, member.last_name);
    }
    return;
  }

  // Check spam / links / media locks
  if (msg.chat.type !== 'private') {
    const { data: group } = await supabase.from('telegram_groups').select('*').eq('chat_id', chatId).single();
    if (group) {
      // Link check
      if (group.lock_links && msg.entities?.some((e: any) => e.type === 'url' || e.type === 'text_link')) {
        const admin = await isAdmin(chatId, userId);
        if (!admin) {
          try { await tgCall('deleteMessage', { chat_id: chatId, message_id: msg.message_id }); } catch {}
          await sendMsg(chatId, `⚠️ @${username} الروابط ممنوعة في هذه المجموعة!`);
          return;
        }
      }
    }
  }

  // Commands
  if (!text.startsWith('/')) {
    // Add points for activity
    if (msg.chat.type !== 'private') {
      await supabase.from('telegram_users')
        .update({ points: supabase.rpc ? undefined : undefined })
        .eq('user_id', userId).eq('chat_id', chatId);
      // Simple point increment via raw
      await supabase.rpc('increment_points', { p_user_id: userId, p_chat_id: chatId }).catch(() => {});
    }
    return;
  }

  const [cmd, ...args] = text.split(/\s+/);
  const command = cmd.toLowerCase().replace('@' + (await tgCall('getMe', {}).catch(() => ({ result: { username: '' } }))).result?.username?.toLowerCase(), '');

  switch (command) {
    case '/start':
      await sendMsg(chatId, '🤖 <b>مرحباً! أنا بوت إدارة المجموعات</b>\n\nاستخدم /help لعرض الأوامر المتاحة');
      break;

    case '/help':
      await sendMsg(chatId, `📋 <b>قائمة الأوامر:</b>\n\n<b>الإدارة:</b>\n/ban - حظر عضو\n/unban - إلغاء حظر\n/kick - طرد عضو\n/mute - كتم عضو\n/unmute - إلغاء كتم\n/warn - تحذير\n/unwarn - إزالة تحذير\n/promote - ترقية لمشرف\n/demote - تخفيض مشرف\n/lock - قفل (links/media)\n/unlock - فتح\n/setwelcome - تعيين رسالة ترحيب\n\n<b>الترفيه:</b>\n/quiz - أسئلة\n/game - تخمين رقم\n/truth - حقيقة\n/dare - تحدي\n/joke - نكتة\n/hack - اختراق وهمي\n/whisper - همسة\n/points - نقاطك\n/random - عضو عشوائي`);
      break;

    case '/ban':
      if (!targetUser) { await sendMsg(chatId, '❌ قم بالرد على رسالة العضو المراد حظره'); break; }
      if (!(await isAdmin(chatId, userId))) { await sendMsg(chatId, '❌ هذا الأمر للمشرفين فقط'); break; }
      try {
        await tgCall('banChatMember', { chat_id: chatId, user_id: targetUser.id });
        await supabase.from('telegram_users').update({ is_banned: true }).eq('user_id', targetUser.id).eq('chat_id', chatId);
        await logAction(supabase, chatId, userId, username, targetUser.id, targetUser.username || targetUser.first_name, 'ban');
        await sendMsg(chatId, `🚫 تم حظر <b>${targetUser.first_name || targetUser.username}</b>`);
      } catch (e) { await sendMsg(chatId, '❌ فشل الحظر. تأكد من صلاحيات البوت'); }
      break;

    case '/unban':
      if (!targetUser) { await sendMsg(chatId, '❌ قم بالرد على رسالة العضو'); break; }
      if (!(await isAdmin(chatId, userId))) { await sendMsg(chatId, '❌ هذا الأمر للمشرفين فقط'); break; }
      try {
        await tgCall('unbanChatMember', { chat_id: chatId, user_id: targetUser.id, only_if_banned: true });
        await supabase.from('telegram_users').update({ is_banned: false }).eq('user_id', targetUser.id).eq('chat_id', chatId);
        await logAction(supabase, chatId, userId, username, targetUser.id, targetUser.username || targetUser.first_name, 'unban');
        await sendMsg(chatId, `✅ تم إلغاء حظر <b>${targetUser.first_name || targetUser.username}</b>`);
      } catch { await sendMsg(chatId, '❌ فشلت العملية'); }
      break;

    case '/kick':
      if (!targetUser) { await sendMsg(chatId, '❌ قم بالرد على رسالة العضو'); break; }
      if (!(await isAdmin(chatId, userId))) { await sendMsg(chatId, '❌ هذا الأمر للمشرفين فقط'); break; }
      try {
        await tgCall('banChatMember', { chat_id: chatId, user_id: targetUser.id });
        await tgCall('unbanChatMember', { chat_id: chatId, user_id: targetUser.id });
        await logAction(supabase, chatId, userId, username, targetUser.id, targetUser.username || targetUser.first_name, 'kick');
        await sendMsg(chatId, `👢 تم طرد <b>${targetUser.first_name || targetUser.username}</b>`);
      } catch { await sendMsg(chatId, '❌ فشل الطرد'); }
      break;

    case '/mute':
      if (!targetUser) { await sendMsg(chatId, '❌ قم بالرد على رسالة العضو'); break; }
      if (!(await isAdmin(chatId, userId))) { await sendMsg(chatId, '❌ هذا الأمر للمشرفين فقط'); break; }
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
      if (!(await isAdmin(chatId, userId))) { await sendMsg(chatId, '❌ هذا الأمر للمشرفين فقط'); break; }
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
      if (!(await isAdmin(chatId, userId))) { await sendMsg(chatId, '❌ هذا الأمر للمشرفين فقط'); break; }
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
      if (!(await isAdmin(chatId, userId))) { await sendMsg(chatId, '❌ هذا الأمر للمشرفين فقط'); break; }
      {
        const { data: user } = await supabase.from('telegram_users').select('warnings').eq('user_id', targetUser.id).eq('chat_id', chatId).single();
        const newW = Math.max(0, (user?.warnings || 0) - 1);
        await supabase.from('telegram_users').update({ warnings: newW }).eq('user_id', targetUser.id).eq('chat_id', chatId);
        await sendMsg(chatId, `✅ تم إزالة تحذير من <b>${targetUser.first_name || targetUser.username}</b> (${newW}/3)`);
      }
      break;

    case '/promote':
      if (!targetUser) { await sendMsg(chatId, '❌ قم بالرد على رسالة العضو'); break; }
      if (!(await isAdmin(chatId, userId))) { await sendMsg(chatId, '❌ هذا الأمر للمشرفين فقط'); break; }
      try {
        await tgCall('promoteChatMember', {
          chat_id: chatId, user_id: targetUser.id,
          can_delete_messages: true, can_restrict_members: true, can_pin_messages: true,
        });
        await logAction(supabase, chatId, userId, username, targetUser.id, targetUser.username || targetUser.first_name, 'promote');
        await sendMsg(chatId, `⬆️ تم ترقية <b>${targetUser.first_name || targetUser.username}</b> لمشرف`);
      } catch { await sendMsg(chatId, '❌ فشلت الترقية'); }
      break;

    case '/demote':
      if (!targetUser) { await sendMsg(chatId, '❌ قم بالرد على رسالة العضو'); break; }
      if (!(await isAdmin(chatId, userId))) { await sendMsg(chatId, '❌ هذا الأمر للمشرفين فقط'); break; }
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
      if (!(await isAdmin(chatId, userId))) { await sendMsg(chatId, '❌ هذا الأمر للمشرفين فقط'); break; }
      if (args[0] === 'links') {
        await supabase.from('telegram_groups').update({ lock_links: true }).eq('chat_id', chatId);
        await sendMsg(chatId, '🔒 تم قفل الروابط');
      } else if (args[0] === 'media') {
        await supabase.from('telegram_groups').update({ lock_media: true }).eq('chat_id', chatId);
        await sendMsg(chatId, '🔒 تم قفل الوسائط');
      } else {
        await sendMsg(chatId, '❌ استخدم: /lock links أو /lock media');
      }
      break;

    case '/unlock':
      if (!(await isAdmin(chatId, userId))) { await sendMsg(chatId, '❌ هذا الأمر للمشرفين فقط'); break; }
      if (args[0] === 'links') {
        await supabase.from('telegram_groups').update({ lock_links: false }).eq('chat_id', chatId);
        await sendMsg(chatId, '🔓 تم فتح الروابط');
      } else if (args[0] === 'media') {
        await supabase.from('telegram_groups').update({ lock_media: false }).eq('chat_id', chatId);
        await sendMsg(chatId, '🔓 تم فتح الوسائط');
      } else {
        await sendMsg(chatId, '❌ استخدم: /unlock links أو /unlock media');
      }
      break;

    case '/setwelcome':
      if (!(await isAdmin(chatId, userId))) { await sendMsg(chatId, '❌ هذا الأمر للمشرفين فقط'); break; }
      {
        const welcomeText = args.join(' ');
        if (!welcomeText) { await sendMsg(chatId, '❌ اكتب رسالة الترحيب بعد الأمر'); break; }
        await supabase.from('telegram_groups').update({ welcome_message: welcomeText }).eq('chat_id', chatId);
        await sendMsg(chatId, `✅ تم تعيين رسالة الترحيب:\n${welcomeText}`);
      }
      break;

    // ==================== ENTERTAINMENT ====================

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
          await new Promise(r => setTimeout(r, 1500));
          if (i === 0) {
            const res = await sendMsg(chatId, `🎯 <b>هدف الاختراق: ${name}</b>\n\n${hackMessages[i]}`);
            msgId = res.result?.message_id;
          } else if (msgId) {
            try {
              await tgCall('editMessageText', {
                chat_id: chatId,
                message_id: msgId,
                text: `🎯 <b>هدف الاختراق: ${name}</b>\n\n${hackMessages.slice(0, i + 1).join('\n')}${i === hackMessages.length - 1 ? `\n\n✅ <b>تم الاختراق بنجاح!</b>\n😂 مجرد مزحة يا ${name}، لا تخاف!` : ''}`,
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
        // Store pending whisper state - user will send the message in private
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
          // Whisper message provided inline
          await sendMsg(chatId, `💌 <b>${username}</b> أرسل همسة لـ <b>${targetUser.first_name || targetUser.username}</b>`, {
            inline_keyboard: [[{ text: '👁 عرض الهمسة', callback_data: `whisper_${whisperId}_${targetUser.id}` }]],
          });
        } else {
          await sendMsg(chatId, `💌 <b>${username}</b> يريد إرسال همسة لـ <b>${targetUser.first_name || targetUser.username}</b>\n\n@${username} أرسل الرسالة للبوت في الخاص`, {
            inline_keyboard: [[{ text: '📩 إرسال همسة للبوت', url: `https://t.me/${(await tgCall('getMe', {})).result.username}?start=whisper_${whisperId}` }]],
          });
        }
      }
      break;

    case '/points': {
      const { data: user } = await supabase.from('telegram_users').select('points, level').eq('user_id', userId).eq('chat_id', chatId).single();
      if (user) {
        await sendMsg(chatId, `🏆 <b>نقاطك:</b> ${user.points}\n⭐ <b>مستواك:</b> ${user.level}`);
      } else {
        await sendMsg(chatId, '❌ لم يتم العثور على بياناتك');
      }
      break;
    }

    case '/random': {
      const { data: members } = await supabase.from('telegram_users').select('*').eq('chat_id', chatId).eq('is_banned', false);
      if (members && members.length > 0) {
        const random = members[Math.floor(Math.random() * members.length)];
        await sendMsg(chatId, `🎲 <b>العضو العشوائي:</b> ${random.first_name || random.username || random.user_id} 🎉`);
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
  const username = callbackQuery.from.first_name || callbackQuery.from.username || '';

  if (data.startsWith('quiz_')) {
    const [, selected, correct] = data.split('_');
    if (selected === correct) {
      // Add points
      await supabase.from('telegram_users').update({ points: supabase.rpc ? undefined : undefined }).eq('user_id', userId).eq('chat_id', chatId);
      await supabase.rpc('increment_points', { p_user_id: userId, p_chat_id: chatId }).catch(() => {});
      await tgCall('answerCallbackQuery', { callback_query_id: callbackQuery.id, text: '✅ إجابة صحيحة! +10 نقاط', show_alert: true });
    } else {
      await tgCall('answerCallbackQuery', { callback_query_id: callbackQuery.id, text: '❌ إجابة خاطئة!', show_alert: true });
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

      // Store messages
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

      // Process each update
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
