import { useEffect, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { Shield } from "lucide-react";

const actionColors: Record<string, string> = {
  ban: "destructive",
  kick: "destructive",
  warn: "outline",
  mute: "secondary",
  unmute: "outline",
  unban: "outline",
  promote: "default",
  demote: "secondary",
};

const actionLabels: Record<string, string> = {
  ban: "حظر", unban: "إلغاء حظر", kick: "طرد", mute: "كتم",
  unmute: "إلغاء كتم", warn: "تحذير", promote: "ترقية", demote: "تخفيض",
};

const LogsPanel = () => {
  const [logs, setLogs] = useState<any[]>([]);
  const [filter, setFilter] = useState("all");

  useEffect(() => {
    const fetch = async () => {
      let query = supabase.from("telegram_admin_logs").select("*").order("created_at", { ascending: false }).limit(100);
      if (filter !== "all") query = query.eq("action", filter);
      const { data } = await query;
      setLogs(data || []);
    };
    fetch();
  }, [filter]);

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">سجل العمليات</h1>
          <p className="text-muted-foreground text-sm mt-1">جميع العمليات الإدارية المسجلة</p>
        </div>
        <Select value={filter} onValueChange={setFilter}>
          <SelectTrigger className="w-40">
            <SelectValue placeholder="فلترة" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">الكل</SelectItem>
            <SelectItem value="ban">حظر</SelectItem>
            <SelectItem value="kick">طرد</SelectItem>
            <SelectItem value="warn">تحذير</SelectItem>
            <SelectItem value="mute">كتم</SelectItem>
            <SelectItem value="promote">ترقية</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {logs.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-16 text-center">
            <Shield className="h-12 w-12 text-muted-foreground mb-4" />
            <p className="text-lg font-medium">لا توجد سجلات</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {logs.map((log) => (
            <Card key={log.id}>
              <CardContent className="p-4 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <Badge variant={actionColors[log.action] as any || "secondary"}>
                    {actionLabels[log.action] || log.action}
                  </Badge>
                  <div>
                    <p className="text-sm">
                      <span className="font-medium">{log.admin_username || "مشرف"}</span>
                      {" → "}
                      <span className="font-medium">{log.target_username || "عضو"}</span>
                    </p>
                    {log.details && <p className="text-xs text-muted-foreground">{log.details}</p>}
                  </div>
                </div>
                <span className="text-xs text-muted-foreground whitespace-nowrap">
                  {new Date(log.created_at).toLocaleString("ar")}
                </span>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
};

export default LogsPanel;
