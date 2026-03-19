import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Users, MessageSquare, Shield, AlertTriangle, TrendingUp } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { ChartContainer, ChartTooltip, ChartTooltipContent } from "@/components/ui/chart";
import { BarChart, Bar, XAxis, YAxis, PieChart, Pie, Cell, AreaChart, Area, ResponsiveContainer } from "recharts";

const DashboardHome = () => {
  const [stats, setStats] = useState({ groups: 0, members: 0, warnings: 0, logs: 0 });
  const [recentLogs, setRecentLogs] = useState<any[]>([]);
  const [actionStats, setActionStats] = useState<any[]>([]);
  const [membersByGroup, setMembersByGroup] = useState<any[]>([]);
  const [activityByDay, setActivityByDay] = useState<any[]>([]);

  useEffect(() => {
    const fetchAll = async () => {
      // Stats
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

      // Recent logs
      const { data: logData } = await supabase
        .from("telegram_admin_logs")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(5);
      setRecentLogs(logData || []);

      // Action distribution
      const { data: allLogs } = await supabase.from("telegram_admin_logs").select("action");
      if (allLogs) {
        const counts: Record<string, number> = {};
        allLogs.forEach((l) => { counts[l.action] = (counts[l.action] || 0) + 1; });
        const labels: Record<string, string> = { ban: "حظر", kick: "طرد", warn: "تحذير", mute: "كتم", promote: "ترقية", report: "بلاغ", unmute: "إلغاء كتم", unban: "إلغاء حظر", demote: "تخفيض" };
        setActionStats(Object.entries(counts).map(([k, v]) => ({ name: labels[k] || k, value: v })));
      }

      // Members by group
      const { data: grpData } = await supabase.from("telegram_groups").select("chat_id, title");
      const { data: usrData } = await supabase.from("telegram_users").select("chat_id");
      if (grpData && usrData) {
        const grpCounts: Record<number, number> = {};
        usrData.forEach((u) => { grpCounts[u.chat_id] = (grpCounts[u.chat_id] || 0) + 1; });
        setMembersByGroup(grpData.map((g) => ({ name: g.title || String(g.chat_id), members: grpCounts[g.chat_id] || 0 })));
      }

      // Activity by day (last 7 days)
      const sevenDaysAgo = new Date(Date.now() - 7 * 86400000).toISOString();
      const { data: recentMessages } = await supabase
        .from("telegram_messages")
        .select("created_at")
        .gte("created_at", sevenDaysAgo);
      if (recentMessages) {
        const dayCounts: Record<string, number> = {};
        const dayNames = ["الأحد", "الإثنين", "الثلاثاء", "الأربعاء", "الخميس", "الجمعة", "السبت"];
        for (let i = 6; i >= 0; i--) {
          const d = new Date(Date.now() - i * 86400000);
          const key = d.toISOString().split("T")[0];
          dayCounts[key] = 0;
        }
        recentMessages.forEach((m) => {
          const key = new Date(m.created_at).toISOString().split("T")[0];
          if (key in dayCounts) dayCounts[key]++;
        });
        setActivityByDay(Object.entries(dayCounts).map(([date, count]) => {
          const d = new Date(date);
          return { name: dayNames[d.getDay()], messages: count };
        }));
      }
    };

    fetchAll();
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
      unmute: "إلغاء كتم", warn: "تحذير", promote: "ترقية", demote: "تخفيض", report: "بلاغ",
    };
    return map[action] || action;
  };

  const COLORS = [
    "hsl(var(--primary))", "hsl(var(--destructive))", "hsl(var(--warning))",
    "hsl(var(--success))", "hsl(var(--accent-foreground))", "hsl(var(--muted-foreground))",
  ];

  const chartConfig = {
    messages: { label: "الرسائل", color: "hsl(var(--primary))" },
    members: { label: "الأعضاء", color: "hsl(var(--success))" },
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">لوحة التحكم</h1>
        <p className="text-muted-foreground text-sm mt-1">نظرة عامة على بوت إدارة المجموعات</p>
      </div>

      {/* Stats Cards */}
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

      {/* Charts Row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Activity Chart */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <TrendingUp className="h-4 w-4 text-primary" />
              نشاط الرسائل (آخر 7 أيام)
            </CardTitle>
          </CardHeader>
          <CardContent>
            {activityByDay.length > 0 ? (
              <ChartContainer config={chartConfig} className="h-[200px] w-full">
                <AreaChart data={activityByDay}>
                  <XAxis dataKey="name" fontSize={12} />
                  <YAxis fontSize={12} />
                  <ChartTooltip content={<ChartTooltipContent />} />
                  <Area type="monotone" dataKey="messages" stroke="hsl(var(--primary))" fill="hsl(var(--primary) / 0.2)" strokeWidth={2} />
                </AreaChart>
              </ChartContainer>
            ) : (
              <p className="text-sm text-muted-foreground text-center py-8">لا توجد بيانات بعد</p>
            )}
          </CardContent>
        </Card>

        {/* Members by Group */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <Users className="h-4 w-4 text-success" />
              الأعضاء حسب المجموعة
            </CardTitle>
          </CardHeader>
          <CardContent>
            {membersByGroup.length > 0 ? (
              <ChartContainer config={chartConfig} className="h-[200px] w-full">
                <BarChart data={membersByGroup}>
                  <XAxis dataKey="name" fontSize={10} />
                  <YAxis fontSize={12} />
                  <ChartTooltip content={<ChartTooltipContent />} />
                  <Bar dataKey="members" fill="hsl(var(--success))" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ChartContainer>
            ) : (
              <p className="text-sm text-muted-foreground text-center py-8">لا توجد بيانات بعد</p>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Action Distribution */}
      {actionStats.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <Shield className="h-4 w-4 text-destructive" />
              توزيع العمليات الإدارية
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex flex-col sm:flex-row items-center gap-4">
              <div className="h-[200px] w-[200px]">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie data={actionStats} cx="50%" cy="50%" outerRadius={80} dataKey="value" label={({ name }) => name}>
                      {actionStats.map((_, i) => (
                        <Cell key={i} fill={COLORS[i % COLORS.length]} />
                      ))}
                    </Pie>
                    <ChartTooltip />
                  </PieChart>
                </ResponsiveContainer>
              </div>
              <div className="flex flex-wrap gap-2">
                {actionStats.map((s, i) => (
                  <div key={s.name} className="flex items-center gap-2 text-sm">
                    <div className="w-3 h-3 rounded-full" style={{ backgroundColor: COLORS[i % COLORS.length] }} />
                    <span>{s.name}: {s.value}</span>
                  </div>
                ))}
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Recent Logs */}
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
