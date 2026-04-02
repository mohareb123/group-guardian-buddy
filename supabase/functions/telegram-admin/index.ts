import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const GATEWAY_URL = 'https://connector-gateway.lovable.dev/telegram';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const LOVABLE_API_KEY = Deno.env.get('LOVABLE_API_KEY');
    if (!LOVABLE_API_KEY) throw new Error('LOVABLE_API_KEY is not configured');

    const TELEGRAM_API_KEY = Deno.env.get('TELEGRAM_API_KEY');
    if (!TELEGRAM_API_KEY) throw new Error('TELEGRAM_API_KEY is not configured');

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const body = await req.json();
    const { action, chat_id, user_id, text } = body;

    const tgHeaders = {
      'Authorization': `Bearer ${LOVABLE_API_KEY}`,
      'X-Connection-Api-Key': TELEGRAM_API_KEY,
      'Content-Type': 'application/json',
    };

    async function tgCall(method: string, payload: any) {
      const res = await fetch(`${GATEWAY_URL}/${method}`, {
        method: 'POST',
        headers: tgHeaders,
        body: JSON.stringify(payload),
      });
      return res.json();
    }

    let result;

    switch (action) {
      case 'sendMessage':
        result = await fetch(`${GATEWAY_URL}/sendMessage`, {
          method: 'POST',
          headers: tgHeaders,
          body: JSON.stringify({ chat_id, text, parse_mode: 'HTML' }),
        });
        break;

      case 'broadcast': {
        const { data: groups } = await supabase.from('telegram_groups').select('chat_id, title');
        if (!groups || groups.length === 0) {
          return new Response(JSON.stringify({ error: 'لا توجد مجموعات', sent: 0 }), {
            status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }
        let sent = 0, failed = 0;
        const results: any[] = [];
        for (const group of groups) {
          try {
            await tgCall('sendMessage', { chat_id: group.chat_id, text: `📢 <b>إشعار هام</b>\n\n${text}`, parse_mode: 'HTML' });
            sent++; results.push({ chat_id: group.chat_id, title: group.title, status: 'sent' });
          } catch { failed++; results.push({ chat_id: group.chat_id, title: group.title, status: 'failed' }); }
        }
        return new Response(JSON.stringify({ ok: true, sent, failed, results }), {
          status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      case 'broadcast_media': {
        const { type, target, caption, file_url, sticker_file_id, poll_question, poll_options } = body;

        // Gather targets
        const targets: { chat_id: number; title?: string; isUser?: boolean }[] = [];

        if (target === 'groups' || target === 'all') {
          const { data: groups } = await supabase.from('telegram_groups').select('chat_id, title');
          if (groups) targets.push(...groups.map(g => ({ chat_id: g.chat_id, title: g.title })));
        }
        if (target === 'users' || target === 'all') {
          const { data: users } = await supabase.from('telegram_users').select('user_id, username, chat_id');
          if (users) {
            // Get unique user IDs to send DMs
            const uniqueUsers = new Map<number, string>();
            for (const u of users) {
              if (!uniqueUsers.has(u.user_id)) uniqueUsers.set(u.user_id, u.username || String(u.user_id));
            }
            for (const [uid, uname] of uniqueUsers) {
              targets.push({ chat_id: uid, title: uname, isUser: true });
            }
          }
        }

        if (targets.length === 0) {
          return new Response(JSON.stringify({ error: 'لا توجد أهداف', sent: 0, failed: 0, results: [] }), {
            status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }

        let sent = 0, failed = 0;
        const results: any[] = [];

        for (const t of targets) {
          try {
            switch (type) {
              case 'text':
                await tgCall('sendMessage', { chat_id: t.chat_id, text: `📢 <b>إشعار هام</b>\n\n${caption}`, parse_mode: 'HTML' });
                break;
              case 'photo':
                await tgCall('sendPhoto', { chat_id: t.chat_id, photo: file_url, caption: caption || undefined, parse_mode: 'HTML' });
                break;
              case 'video':
                await tgCall('sendVideo', { chat_id: t.chat_id, video: file_url, caption: caption || undefined, parse_mode: 'HTML' });
                break;
              case 'audio':
                await tgCall('sendVoice', { chat_id: t.chat_id, voice: file_url, caption: caption || undefined, parse_mode: 'HTML' });
                break;
              case 'document':
                await tgCall('sendDocument', { chat_id: t.chat_id, document: file_url, caption: caption || undefined, parse_mode: 'HTML' });
                break;
              case 'sticker':
                await tgCall('sendSticker', { chat_id: t.chat_id, sticker: sticker_file_id });
                break;
              case 'poll':
                await tgCall('sendPoll', { chat_id: t.chat_id, question: poll_question, options: poll_options.map((o: string) => ({ text: o })), is_anonymous: false });
                break;
            }
            sent++;
            results.push({ chat_id: t.chat_id, title: t.title, status: 'sent' });
          } catch {
            failed++;
            results.push({ chat_id: t.chat_id, title: t.title, status: 'failed' });
          }
        }

        return new Response(JSON.stringify({ ok: true, sent, failed, results }), {
          status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      case 'ban':
        result = await fetch(`${GATEWAY_URL}/banChatMember`, { method: 'POST', headers: tgHeaders, body: JSON.stringify({ chat_id, user_id }) });
        break;

      case 'unban':
        result = await fetch(`${GATEWAY_URL}/unbanChatMember`, { method: 'POST', headers: tgHeaders, body: JSON.stringify({ chat_id, user_id, only_if_banned: true }) });
        break;

      case 'kick':
        await fetch(`${GATEWAY_URL}/banChatMember`, { method: 'POST', headers: tgHeaders, body: JSON.stringify({ chat_id, user_id }) });
        result = await fetch(`${GATEWAY_URL}/unbanChatMember`, { method: 'POST', headers: tgHeaders, body: JSON.stringify({ chat_id, user_id }) });
        break;

      case 'mute':
        result = await fetch(`${GATEWAY_URL}/restrictChatMember`, { method: 'POST', headers: tgHeaders, body: JSON.stringify({ chat_id, user_id, permissions: { can_send_messages: false } }) });
        break;

      case 'unmute':
        result = await fetch(`${GATEWAY_URL}/restrictChatMember`, { method: 'POST', headers: tgHeaders, body: JSON.stringify({ chat_id, user_id, permissions: { can_send_messages: true, can_send_media_messages: true, can_send_other_messages: true } }) });
        break;

      default:
        return new Response(JSON.stringify({ error: 'Unknown action' }), {
          status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
    }

    const data = await result!.json();
    return new Response(JSON.stringify(data), {
      status: result!.ok ? 200 : 502,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Unknown error';
    return new Response(JSON.stringify({ error: msg }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
