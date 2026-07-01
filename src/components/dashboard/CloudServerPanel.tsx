import { useEffect, useRef, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import {
  Server, Cloud, Terminal, ShieldAlert, Play, Sparkles, Save, Trash2, Loader2, KeyRound, Wifi,
} from "lucide-react";
import {
  type VpsConfig, type ExecResult,
  loadConfig, saveConfig, generateCommand, executeCommand, inspectCommand,
} from "@/services/vpsService";

type Status = "idle" | "executing" | "error";

interface Line {
  kind: "cmd" | "out" | "err" | "sys";
  text: string;
  ts: string;
}

const emptyConfig: VpsConfig = { host: "", port: 22, username: "", privateKey: "", simulatorMode: true };

const CloudServerPanel = () => {
  const [config, setConfig] = useState<VpsConfig>(emptyConfig);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<Status>("idle");
  const [prompt, setPrompt] = useState("");
  const [command, setCommand] = useState("");
  const [generating, setGenerating] = useState(false);
  const [lines, setLines] = useState<Line[]>([]);
  const termRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    loadConfig().then((c) => { if (c) setConfig(c); });
  }, []);

  useEffect(() => {
    termRef.current?.scrollTo({ top: termRef.current.scrollHeight, behavior: "smooth" });
  }, [lines]);

  const now = () => new Date().toLocaleTimeString("ar-EG", { hour12: false });
  const push = (kind: Line["kind"], text: string) => setLines((p) => [...p, { kind, text, ts: now() }]);

  const handleSave = async () => {
    setSaving(true);
    try {
      await saveConfig(config);
      toast.success("تم حفظ إعدادات السيرفر بأمان");
    } catch (e: any) {
      toast.error("فشل الحفظ: " + (e.message ?? e));
    } finally {
      setSaving(false);
    }
  };

  const handleGenerate = async () => {
    if (!prompt.trim()) return;
    setGenerating(true);
    try {
      const cmd = await generateCommand(prompt.trim());
      if (cmd === "ERROR_UNAUTHORIZED_COMMAND" || inspectCommand(cmd).reason === "unauthorized") {
        toast.error("🚫 تنبيه أمني: تم حظر أمر غير مصرح به.", {
          className: "!bg-destructive !text-destructive-foreground !border-destructive",
        });
        push("err", "Security Alert: Unsafe command blocked (AI refused).");
        setCommand("");
        return;
      }
      setCommand(cmd);
      push("sys", `AI generated: ${cmd}`);
    } catch (e: any) {
      toast.error("فشل توليد الأمر: " + (e.message ?? e));
    } finally {
      setGenerating(false);
    }
  };

  const runCommand = async (raw: string) => {
    const cmd = raw.trim();
    if (!cmd) return;

    // Client-side security middleware — intercept BEFORE hitting the backend.
    const check = inspectCommand(cmd);
    if (!check.safe) {
      toast.error("🚫 Security Alert: Unsafe command blocked.", {
        description: `الأمر يحتوي على نمط خطير: ${check.reason}`,
        className: "!bg-destructive !text-destructive-foreground !border-destructive",
      });
      push("err", `Security Alert: Unsafe command blocked (${check.reason}).`);
      return;
    }

    push("cmd", cmd);
    setStatus("executing");
    try {
      const res: ExecResult = await executeCommand(config, cmd);
      if (res.status === "blocked") {
        setStatus("error");
        toast.error("🚫 Security Alert: Unsafe command blocked.", {
          className: "!bg-destructive !text-destructive-foreground !border-destructive",
        });
        push("err", res.output);
        return;
      }
      if (res.status === "error") {
        setStatus("error");
        push("err", res.output);
        toast.error("خطأ في الاتصال بالسيرفر");
        return;
      }
      push("out", res.output + (res.durationMs ? `\n[done in ${res.durationMs}ms]` : ""));
      setStatus("idle");
    } catch (e: any) {
      setStatus("error");
      push("err", String(e.message ?? e));
      toast.error("خطأ في الاتصال بالسيرفر");
    }
  };

  const statusMeta: Record<Status, { label: string; className: string; icon: React.ReactNode }> = {
    idle: {
      label: "جاهز · Idle",
      className: "bg-success text-success-foreground border-transparent",
      icon: <Wifi className="h-3.5 w-3.5" />,
    },
    executing: {
      label: "جارٍ التنفيذ...",
      className: "bg-primary text-primary-foreground border-transparent animate-pulse-glow",
      icon: <Loader2 className="h-3.5 w-3.5 animate-spin" />,
    },
    error: {
      label: "خطأ في الاتصال",
      className: "bg-destructive text-destructive-foreground border-transparent",
      icon: <ShieldAlert className="h-3.5 w-3.5" />,
    },
  };

  const lineColor: Record<Line["kind"], string> = {
    cmd: "text-primary",
    out: "text-emerald-400",
    err: "text-red-400",
    sys: "text-amber-400",
  };
  const linePrefix: Record<Line["kind"], string> = { cmd: "$", out: " ", err: "✗", sys: "»" };

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Cloud className="h-6 w-6 text-primary" /> الحاسوب السحابي
          </h1>
          <p className="text-muted-foreground text-sm mt-1">تنفيذ الأوامر على سيرفر لينكس عن بُعد عبر الذكاء الاصطناعي</p>
        </div>
        <Badge className={`gap-1.5 px-3 py-1.5 text-xs font-semibold ${statusMeta[status].className}`}>
          {statusMeta[status].icon}
          {statusMeta[status].label}
        </Badge>
      </div>

      {/* Settings */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Server className="h-5 w-5 text-primary" /> إعدادات السيرفر السحابي
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="sm:col-span-2 space-y-1.5">
              <Label htmlFor="host">عنوان السيرفر (Host IP)</Label>
              <Input id="host" placeholder="123.45.67.89" value={config.host}
                onChange={(e) => setConfig({ ...config, host: e.target.value })} dir="ltr" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="port">المنفذ (Port)</Label>
              <Input id="port" type="number" placeholder="22" value={config.port}
                onChange={(e) => setConfig({ ...config, port: Number(e.target.value) || 22 })} dir="ltr" />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="username">اسم المستخدم (Username)</Label>
            <Input id="username" placeholder="root" value={config.username}
              onChange={(e) => setConfig({ ...config, username: e.target.value })} dir="ltr" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="pk" className="flex items-center gap-1.5">
              <KeyRound className="h-4 w-4" /> المفتاح الخاص (Private Key)
            </Label>
            <Textarea id="pk" placeholder="-----BEGIN OPENSSH PRIVATE KEY-----" rows={4}
              value={config.privateKey} onChange={(e) => setConfig({ ...config, privateKey: e.target.value })}
              className="font-mono text-xs" dir="ltr" />
          </div>
          <div className="flex items-center justify-between rounded-lg border border-border p-3">
            <div className="space-y-0.5">
              <Label htmlFor="sim" className="font-medium">وضع المحاكاة (Simulator)</Label>
              <p className="text-xs text-muted-foreground">جرّب التدفق كاملاً داخل المعاينة بدون اتصال حقيقي</p>
            </div>
            <Switch id="sim" checked={config.simulatorMode}
              onCheckedChange={(v) => setConfig({ ...config, simulatorMode: v })} />
          </div>
          <Button onClick={handleSave} disabled={saving} className="w-full sm:w-auto">
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            حفظ الإعدادات بأمان
          </Button>
        </CardContent>
      </Card>

      {/* AI command builder */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-primary" /> اطلب مهمة بلغتك الطبيعية
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-col sm:flex-row gap-2">
            <Input placeholder="مثال: نزّل الملف من الرابط وشغّله بـ Python، أو افحص ذاكرة السيرفر"
              value={prompt} onChange={(e) => setPrompt(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleGenerate()} />
            <Button onClick={handleGenerate} disabled={generating} variant="secondary" className="shrink-0">
              {generating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
              توليد الأمر
            </Button>
          </div>
          <div className="flex flex-col sm:flex-row gap-2">
            <Input value={command} onChange={(e) => setCommand(e.target.value)}
              placeholder="الأمر المُولَّد سيظهر هنا (يمكنك تعديله)" dir="ltr"
              className="font-mono text-sm"
              onKeyDown={(e) => e.key === "Enter" && runCommand(command)} />
            <Button onClick={() => runCommand(command)} disabled={status === "executing" || !command.trim()}
              className="shrink-0">
              {status === "executing" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
              تنفيذ
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Live terminal */}
      <Card className="overflow-hidden">
        <div className="flex items-center justify-between px-4 py-2.5 bg-[#0d1117] border-b border-white/10">
          <div className="flex items-center gap-2">
            <div className="flex gap-1.5">
              <span className="w-3 h-3 rounded-full bg-red-500" />
              <span className="w-3 h-3 rounded-full bg-yellow-500" />
              <span className="w-3 h-3 rounded-full bg-green-500" />
            </div>
            <span className="text-xs text-gray-400 font-mono flex items-center gap-1.5 mr-2">
              <Terminal className="h-3.5 w-3.5" />
              {config.simulatorMode ? "simulator@cloud" : `${config.username || "user"}@${config.host || "server"}`}
            </span>
          </div>
          <Button variant="ghost" size="sm" onClick={() => setLines([])}
            className="h-7 px-2 text-gray-400 hover:text-white hover:bg-white/10">
            <Trash2 className="h-3.5 w-3.5" /> مسح
          </Button>
        </div>
        <div ref={termRef} className="bg-black h-[45vh] overflow-y-auto p-4 font-mono text-[13px] leading-relaxed" dir="ltr">
          {lines.length === 0 ? (
            <p className="text-gray-600">$ في انتظار الأوامر... اطلب مهمة بالأعلى ثم نفّذها.</p>
          ) : (
            lines.map((l, i) => (
              <div key={i} className={`whitespace-pre-wrap break-words ${lineColor[l.kind]}`}>
                <span className="text-gray-600 select-none">[{l.ts}] </span>
                <span className="select-none">{linePrefix[l.kind]} </span>
                {l.text}
              </div>
            ))
          )}
        </div>
      </Card>
    </div>
  );
};

export default CloudServerPanel;
