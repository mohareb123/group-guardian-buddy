import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Users, MessageSquare, Shield, AlertTriangle } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

const DashboardHome = () => {
  const [stats, setStats] = useState({ groups: 0, members: 0, warnings: 0, logs: 0 });
  const [recentLogs, setRecentLogs] = useState<any[]>([]);

  useEffect(() => {
    const fetchStats = async () => {
      const [groups, members, warnings, logs] = await Promise.all([
        supabase.from("telegram_groups").select("*", { count: "exact", head: true }),
        supabase.from("telegram_users").select("*", { count: "exact", head: true }),
        supabase.from("telegram_users").select("warnings").gt("warnings", 0),
        supabase.from("telegram_admin_logs").select("*", { count: "exact", head: true }),
      ]);
      setStats({
        groups: groups.count || 0,
        members: members.count || 0,
        warnings: warnings.data?.reduce((sum, u) => sum + (u.warnings || 0), 0) || 0,
        logs: logs.count || 0,
      });
    };

    const fetchLogs = async () => {
      const { data } = await supabase
        .from("telegram_admin_logs")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(5);
      setRecentLogs(data || []);
    };

    fetchStats();
    fetchLogs();
  }, []);

  const statCards = [
    { title: "المجموعات", value: stats.groups, icon: MessageSquare, color: "text-primary" },
    { title: "الأعضاء", value: stats.members, icon: Users, color: "text-success" },
    { title: "التحذيرات", value: stats.warnings, icon: AlertTriangle, color: "text-warning" },
    { title: "العمليات", value: stats.logs, icon: Shield, color: "text-destructive" },
  ];

  const actionLabel = (action: string) => {
    const map: Record<string, string> = {
      ban: "حظر", unban: "إلغاء حظر", kick: "طرد", mute: "كتم",
      unmute: "إلغاء كتم", warn: "تحذير", promote: "ترقية", demote: "تخفيض",
    };
    return map[action] || action;
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">لوحة التحكم</h1>
        <p className="text-muted-foreground text-sm mt-1">نظرة عامة على بوت إدارة المجموعات</p>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {statCards.map((stat) => {
          const Icon = stat.icon;
          return (
            <Card key={stat.title}>
              <CardContent className="p-4 flex items-center gap-4">
                <div className={`p-3 rounded-xl bg-accent ${stat.color}`}>
                  <Icon className="h-6 w-6" />
                </div>
                <div>
                  <p className="text-2xl font-bold">{stat.value}</p>
                  <p className="text-xs text-muted-foreground">{stat.title}</p>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">آخر العمليات</CardTitle>
        </CardHeader>
        <CardContent>
          {recentLogs.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-8">لا توجد عمليات بعد</p>
          ) : (
            <div className="space-y-3">
              {recentLogs.map((log) => (
                <div key={log.id} className="flex items-center justify-between p-3 rounded-lg bg-muted/50">
                  <div className="flex items-center gap-3">
                    <Shield className="h-4 w-4 text-muted-foreground" />
                    <div>
                      <p className="text-sm font-medium">
                        {log.admin_username || "مشرف"} قام بـ {actionLabel(log.action)} {log.target_username || "عضو"}
                      </p>
                      {log.details && <p className="text-xs text-muted-foreground">{log.details}</p>}
                    </div>
                  </div>
                  <span className="text-xs text-muted-foreground">
                    {new Date(log.created_at).toLocaleString("ar")}
                  </span>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
};

export default DashboardHome;
