import { useEffect, useRef, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ScrollArea } from "@/components/ui/scroll-area";
import { supabase } from "@/integrations/supabase/client";
import { Terminal, Trash2, Pause, Play, Download } from "lucide-react";
import { toast } from "sonner";

type LogRow = {
  id: string;
  level: "info" | "warn" | "error" | "debug";
  source: string;
  event: string;
  message: string | null;
  context: any;
  chat_id: number | null;
  user_id: number | null;
  created_at: string;
};

const levelStyle: Record<string, { variant: any; color: string; label: string }> = {
  error: { variant: "destructive", color: "text-destructive", label: "خطأ" },
  warn:  { variant: "outline",     color: "text-warning",     label: "تحذير" },
  info:  { variant: "secondary",   color: "text-primary",     label: "معلومة" },
  debug: { variant: "outline",     color: "text-muted-foreground", label: "تشخيص" },
};

const ConsolePanel = () => {
  const [logs, setLogs] = useState<LogRow[]>([]);
  const [filter, setFilter] = useState<string>("all");
  const [paused, setPaused] = useState(false);
  const pausedRef = useRef(paused);
  pausedRef.current = paused;

  useEffect(() => {
    const load = async () => {
      let q = supabase.from("system_logs" as any).select("*").order("created_at", { ascending: false }).limit(200);
      if (filter !== "all") q = q.eq("level", filter);
      const { data } = await q;
      setLogs((data as any) || []);
    };
    load();

    const channel = supabase
      .channel("system_logs_live")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "system_logs" }, (payload) => {
        if (pausedRef.current) return;
        const row = payload.new as LogRow;
        if (filter !== "all" && row.level !== filter) return;
        setLogs((prev) => [row, ...prev].slice(0, 200));
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [filter]);

  const clear = () => setLogs([]);
  const download = () => {
    const blob = new Blob([JSON.stringify(logs, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `console-logs-${Date.now()}.json`; a.click();
    URL.revokeObjectURL(url);
    toast.success("تم تنزيل اللوجات");
  };

  const counts = logs.reduce((acc, l) => { acc[l.level] = (acc[l.level] || 0) + 1; return acc; }, {} as Record<string, number>);

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Terminal className="h-6 w-6 text-primary" /> الكونسول المباشر
          </h1>
          <p className="text-muted-foreground text-sm mt-1">لوجات النظام والأخطاء لحظياً</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="destructive">أخطاء: {counts.error || 0}</Badge>
          <Badge variant="outline" className="border-warning text-warning">تحذيرات: {counts.warn || 0}</Badge>
          <Badge variant="secondary">معلومات: {counts.info || 0}</Badge>
        </div>
      </div>

      <Card>
        <CardContent className="p-3 flex flex-wrap items-center gap-2">
          <Select value={filter} onValueChange={setFilter}>
            <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">الكل</SelectItem>
              <SelectItem value="error">أخطاء</SelectItem>
              <SelectItem value="warn">تحذيرات</SelectItem>
              <SelectItem value="info">معلومات</SelectItem>
              <SelectItem value="debug">تشخيص</SelectItem>
            </SelectContent>
          </Select>
          <Button variant={paused ? "default" : "outline"} size="sm" onClick={() => setPaused(!paused)}>
            {paused ? <><Play className="h-4 w-4" /> استئناف</> : <><Pause className="h-4 w-4" /> إيقاف مؤقت</>}
          </Button>
          <Button variant="outline" size="sm" onClick={download}>
            <Download className="h-4 w-4" /> تنزيل
          </Button>
          <Button variant="outline" size="sm" onClick={clear}>
            <Trash2 className="h-4 w-4" /> مسح
          </Button>
          <span className="text-xs text-muted-foreground mr-auto">
            {paused ? "⏸ متوقف" : "🟢 مباشر"} · {logs.length} سجل
          </span>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0">
          <ScrollArea className="h-[60vh]">
            {logs.length === 0 ? (
              <div className="py-16 text-center text-muted-foreground text-sm">لا توجد لوجات بعد. الأحداث ستظهر هنا تلقائياً.</div>
            ) : (
              <div className="divide-y divide-border font-mono text-xs">
                {logs.map((log) => {
                  const s = levelStyle[log.level] || levelStyle.info;
                  return (
                    <div key={log.id} className="p-3 hover:bg-muted/40">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-muted-foreground">{new Date(log.created_at).toLocaleTimeString("ar")}</span>
                        <Badge variant={s.variant}>{s.label}</Badge>
                        <span className="text-muted-foreground">[{log.source}]</span>
                        <span className={`font-semibold ${s.color}`}>{log.event}</span>
                      </div>
                      {log.message && <div className="mt-1 text-foreground whitespace-pre-wrap break-words">{log.message}</div>}
                      {log.context && Object.keys(log.context).length > 0 && (
                        <pre className="mt-1 text-muted-foreground bg-muted/40 rounded p-2 overflow-auto">
{JSON.stringify(log.context, null, 2)}
                        </pre>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </ScrollArea>
        </CardContent>
      </Card>
    </div>
  );
};

export default ConsolePanel;
