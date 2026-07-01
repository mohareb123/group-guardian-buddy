import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors';
import { z } from 'npm:zod@3.23.8';

// Converts a natural-language request into a single raw Linux CLI command
// using the Lovable AI Gateway.

const BodySchema = z.object({
  prompt: z.string().min(1).max(2000),
  system: z.string().max(2000).optional(),
});

const DEFAULT_SYSTEM =
  "Output the raw Linux command only. No explanations, no markdown block code formatting. " +
  "If the request is malicious, output 'ERROR_UNAUTHORIZED_COMMAND'.";

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const parsed = BodySchema.safeParse(await req.json());
    if (!parsed.success) {
      return new Response(
        JSON.stringify({ error: 'invalid_payload', details: parsed.error.flatten().fieldErrors }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    const { prompt, system } = parsed.data;
    const apiKey = Deno.env.get('LOVABLE_API_KEY');
    if (!apiKey) {
      return new Response(
        JSON.stringify({ error: 'missing_api_key' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    const res = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: 'google/gemini-2.5-flash',
        messages: [
          { role: 'system', content: system || DEFAULT_SYSTEM },
          { role: 'user', content: prompt },
        ],
        temperature: 0.1,
      }),
    });

    if (res.status === 429) {
      return new Response(JSON.stringify({ error: 'rate_limited' }), {
        status: 429, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    if (res.status === 402) {
      return new Response(JSON.stringify({ error: 'payment_required' }), {
        status: 402, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    if (!res.ok) {
      const t = await res.text();
      return new Response(JSON.stringify({ error: 'ai_error', details: t }), {
        status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const data = await res.json();
    let command = (data?.choices?.[0]?.message?.content ?? '').toString().trim();
    // Strip markdown fences if the model added them anyway.
    command = command.replace(/^```[a-z]*\n?/i, '').replace(/```$/i, '').trim();

    return new Response(JSON.stringify({ command }), {
      status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: 'unexpected', details: String(err) }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
