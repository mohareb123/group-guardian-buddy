import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors';
import { z } from 'npm:zod@3.23.8';

// ---------------------------------------------------------------------------
// execute-ssh-command
// Accepts a payload { host, port, username, privateKey, command } and runs the
// command on a remote Linux server over SSH.
//
// NOTE: Browsers cannot open raw TCP/SSH sockets, so this server-side function
// is the bridge. Deno Deploy does not ship a native SSH client, so the actual
// connection is delegated to an external SSH gateway (SSH_GATEWAY_URL) when it
// is configured. If no gateway is configured, the function returns a clear,
// structured "not_configured" response so the UI can fall back to the built-in
// simulator. Replace the gateway call below with your preferred SSH client
// environment (e.g. a small Node/Bun microservice using `ssh2`).
// ---------------------------------------------------------------------------

const PayloadSchema = z.object({
  host: z.string().min(1).max(255),
  port: z.number().int().min(1).max(65535).default(22),
  username: z.string().min(1).max(128),
  privateKey: z.string().min(1).max(20000),
  command: z.string().min(1).max(4000),
});

// Server-side guardrails — never trust the client. These mirror the
// client-side middleware but are enforced again here.
const DANGEROUS_PATTERNS = [
  /\brm\s+-rf\b/i,
  /\bsudoers\b/i,
  /\bfdisk\b/i,
  /\bmkfs\b/i,
  /\bdd\s+if=/i,
  />\s*\/dev\/sd/i,
  /:\(\)\s*\{.*\}\s*;/, // fork bomb
  /\bshutdown\b/i,
  /\breboot\b/i,
  /ERROR_UNAUTHORIZED_COMMAND/,
];

function isDangerous(cmd: string): boolean {
  return DANGEROUS_PATTERNS.some((re) => re.test(cmd));
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const parsed = PayloadSchema.safeParse(await req.json());
    if (!parsed.success) {
      return new Response(
        JSON.stringify({ status: 'error', error: 'invalid_payload', details: parsed.error.flatten().fieldErrors }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    const { host, port, username, privateKey, command } = parsed.data;

    // Second line of defense: block dangerous commands server-side.
    if (isDangerous(command)) {
      return new Response(
        JSON.stringify({ status: 'blocked', error: 'unsafe_command', output: 'Security Alert: Unsafe command blocked (server-side).' }),
        { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    const gatewayUrl = Deno.env.get('SSH_GATEWAY_URL');
    const gatewayToken = Deno.env.get('SSH_GATEWAY_TOKEN');

    // No external SSH gateway configured yet — tell the UI to use its simulator.
    if (!gatewayUrl) {
      return new Response(
        JSON.stringify({
          status: 'not_configured',
          output:
            '[execute-ssh-command] No SSH gateway configured.\n' +
            'Set SSH_GATEWAY_URL (and optionally SSH_GATEWAY_TOKEN) secrets and point them at\n' +
            'an SSH client environment (e.g. a Node service using the `ssh2` package).\n' +
            'Until then, enable Simulator Mode in the dashboard to preview the full flow.',
        }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    // Delegate the real SSH execution to the configured gateway.
    const started = Date.now();
    const res = await fetch(gatewayUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(gatewayToken ? { Authorization: `Bearer ${gatewayToken}` } : {}),
      },
      body: JSON.stringify({ host, port, username, privateKey, command }),
    });

    const text = await res.text();
    let payload: unknown;
    try { payload = JSON.parse(text); } catch { payload = { output: text }; }

    if (!res.ok) {
      return new Response(
        JSON.stringify({ status: 'error', error: 'gateway_error', output: (payload as any)?.output ?? text }),
        { status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    return new Response(
      JSON.stringify({
        status: 'success',
        durationMs: Date.now() - started,
        output: (payload as any)?.output ?? text,
        exitCode: (payload as any)?.exitCode ?? 0,
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ status: 'error', error: 'unexpected', output: String(err) }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  }
});
