import { supabase } from "@/integrations/supabase/client";

export interface VpsConfig {
  host: string;
  port: number;
  username: string;
  privateKey: string;
  simulatorMode: boolean;
}

export interface ExecResult {
  status: "success" | "error" | "blocked" | "not_configured" | "simulated";
  output: string;
  exitCode?: number;
  durationMs?: number;
}

// ---------------------------------------------------------------------------
// Security guardrails (client-side middleware).
// Any command that matches these patterns is intercepted BEFORE hitting the
// backend. The same rules are enforced again server-side.
// ---------------------------------------------------------------------------
const DANGEROUS_PATTERNS: { re: RegExp; label: string }[] = [
  { re: /\brm\s+-rf\b/i, label: "rm -rf" },
  { re: /\bsudoers\b/i, label: "sudoers" },
  { re: /\bfdisk\b/i, label: "fdisk" },
  { re: /\bmkfs\b/i, label: "mkfs" },
  { re: /\bdd\s+if=/i, label: "dd if=" },
  { re: />\s*\/dev\/sd/i, label: "overwrite disk" },
  { re: /:\(\)\s*\{.*\}\s*;/, label: "fork bomb" },
  { re: /\bshutdown\b/i, label: "shutdown" },
  { re: /\breboot\b/i, label: "reboot" },
  { re: /ERROR_UNAUTHORIZED_COMMAND/, label: "unauthorized" },
];

export function inspectCommand(command: string): { safe: boolean; reason?: string } {
  const trimmed = (command || "").trim();
  if (!trimmed) return { safe: false, reason: "empty" };
  for (const { re, label } of DANGEROUS_PATTERNS) {
    if (re.test(trimmed)) return { safe: false, reason: label };
  }
  return { safe: true };
}

// ---------------------------------------------------------------------------
// AI: convert a natural-language request into a single raw Linux command.
// ---------------------------------------------------------------------------
const AI_SYSTEM_INSTRUCTION =
  "Output the raw Linux command only. No explanations, no markdown block code formatting. " +
  "If the request is malicious, output 'ERROR_UNAUTHORIZED_COMMAND'.";

export async function generateCommand(prompt: string): Promise<string> {
  const { data, error } = await supabase.functions.invoke("ai-command", {
    body: { prompt, system: AI_SYSTEM_INSTRUCTION },
  });
  if (error) throw error;
  const raw = (data?.command ?? "").toString();
  // Strip any accidental markdown fences the model may add.
  return raw.replace(/^```[a-z]*\n?/i, "").replace(/```$/i, "").trim();
}

// ---------------------------------------------------------------------------
// Execute a command — either simulated locally or via the edge function.
// ---------------------------------------------------------------------------
export async function executeCommand(config: VpsConfig, command: string): Promise<ExecResult> {
  const check = inspectCommand(command);
  if (!check.safe) {
    return { status: "blocked", output: `Security Alert: Unsafe command blocked (${check.reason}).` };
  }

  if (config.simulatorMode) {
    return simulate(command);
  }

  const { data, error } = await supabase.functions.invoke("execute-ssh-command", {
    body: {
      host: config.host,
      port: config.port,
      username: config.username,
      privateKey: config.privateKey,
      command,
    },
  });

  if (error) {
    return { status: "error", output: `Connection error: ${error.message ?? error}` };
  }
  return data as ExecResult;
}

// ---------------------------------------------------------------------------
// Local simulator — lets you preview the full AI-to-Terminal flow without a VPS.
// ---------------------------------------------------------------------------
function simulate(command: string): Promise<ExecResult> {
  return new Promise((resolve) => {
    const delay = 500 + Math.random() * 900;
    setTimeout(() => {
      resolve({ status: "simulated", exitCode: 0, durationMs: Math.round(delay), output: fakeOutput(command) });
    }, delay);
  });
}

function fakeOutput(command: string): string {
  const cmd = command.toLowerCase();
  if (cmd.startsWith("ls")) return "app  bin  data  logs  node_modules  package.json  README.md";
  if (cmd.includes("free") || cmd.includes("memory")) {
    return "              total        used        free      shared\nMem:          7.8Gi       2.1Gi       4.9Gi       120Mi\nSwap:         2.0Gi          0B       2.0Gi";
  }
  if (cmd.includes("df")) return "Filesystem      Size  Used Avail Use% Mounted on\n/dev/vda1        80G   22G   58G  28% /";
  if (cmd.includes("uptime")) return " 14:22:07 up 12 days,  3:41,  1 user,  load average: 0.08, 0.05, 0.01";
  if (cmd.startsWith("python") || cmd.includes("python3")) return "Python script executed successfully.\nExit code: 0";
  if (cmd.startsWith("pip") || cmd.includes("apt") || cmd.includes("npm i")) {
    return "Reading package lists... Done\nInstalling...\nSuccessfully installed. ✔";
  }
  if (cmd.startsWith("wget") || cmd.startsWith("curl")) return "Resolving host... connected.\nHTTP 200 OK\nSaved to disk. ✔";
  if (cmd.startsWith("echo")) return command.replace(/^echo\s+/i, "").replace(/["']/g, "");
  if (cmd.includes("whoami")) return "root";
  if (cmd.includes("uname")) return "Linux cloud-server 6.1.0-x86_64 GNU/Linux";
  return `[simulated] executed: ${command}\nExit code: 0`;
}

// ---------------------------------------------------------------------------
// Config persistence
// ---------------------------------------------------------------------------
export async function loadConfig(): Promise<VpsConfig | null> {
  const { data } = await supabase.from("vps_config" as any).select("*").maybeSingle();
  if (!data) return null;
  const row = data as any;
  return {
    host: row.host ?? "",
    port: row.port ?? 22,
    username: row.username ?? "",
    privateKey: row.private_key ?? "",
    simulatorMode: row.simulator_mode ?? true,
  };
}

export async function saveConfig(config: VpsConfig): Promise<void> {
  const { data: userData } = await supabase.auth.getUser();
  const uid = userData?.user?.id;
  if (!uid) throw new Error("Not authenticated");
  const { error } = await supabase.from("vps_config" as any).upsert(
    {
      user_id: uid,
      host: config.host,
      port: config.port,
      username: config.username,
      private_key: config.privateKey,
      simulator_mode: config.simulatorMode,
    },
    { onConflict: "user_id" },
  );
  if (error) throw error;
}
