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

    const { action, chat_id, user_id, text } = await req.json();

    const tgHeaders = {
      'Authorization': `Bearer ${LOVABLE_API_KEY}`,
      'X-Connection-Api-Key': TELEGRAM_API_KEY,
      'Content-Type': 'application/json',
    };

    let result;

    switch (action) {
      case 'sendMessage':
        result = await fetch(`${GATEWAY_URL}/sendMessage`, {
          method: 'POST',
          headers: tgHeaders,
          body: JSON.stringify({ chat_id, text, parse_mode: 'HTML' }),
        });
        break;

      case 'ban':
        result = await fetch(`${GATEWAY_URL}/banChatMember`, {
          method: 'POST',
          headers: tgHeaders,
          body: JSON.stringify({ chat_id, user_id }),
        });
        break;

      case 'unban':
        result = await fetch(`${GATEWAY_URL}/unbanChatMember`, {
          method: 'POST',
          headers: tgHeaders,
          body: JSON.stringify({ chat_id, user_id, only_if_banned: true }),
        });
        break;

      case 'kick':
        await fetch(`${GATEWAY_URL}/banChatMember`, {
          method: 'POST',
          headers: tgHeaders,
          body: JSON.stringify({ chat_id, user_id }),
        });
        result = await fetch(`${GATEWAY_URL}/unbanChatMember`, {
          method: 'POST',
          headers: tgHeaders,
          body: JSON.stringify({ chat_id, user_id }),
        });
        break;

      case 'mute':
        result = await fetch(`${GATEWAY_URL}/restrictChatMember`, {
          method: 'POST',
          headers: tgHeaders,
          body: JSON.stringify({
            chat_id, user_id,
            permissions: { can_send_messages: false },
          }),
        });
        break;

      case 'unmute':
        result = await fetch(`${GATEWAY_URL}/restrictChatMember`, {
          method: 'POST',
          headers: tgHeaders,
          body: JSON.stringify({
            chat_id, user_id,
            permissions: { can_send_messages: true, can_send_media_messages: true, can_send_other_messages: true },
          }),
        });
        break;

      default:
        return new Response(JSON.stringify({ error: 'Unknown action' }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
    }

    const data = await result.json();
    return new Response(JSON.stringify(data), {
      status: result.ok ? 200 : 502,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Unknown error';
    return new Response(JSON.stringify({ error: msg }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
