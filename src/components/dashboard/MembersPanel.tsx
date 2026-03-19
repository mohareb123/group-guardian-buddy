import { useEffect, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { Users, Ban, UserX, VolumeX, AlertTriangle } from "lucide-react";
import { toast } from "sonner";

const MembersPanel = () => {
  const [members, setMembers] = useState<any[]>([]);
  const [groups, setGroups] = useState<any[]>([]);
  const [selectedGroup, setSelectedGroup] = useState<string>("all");
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  const fetchMembers = async () => {
    let query = supabase.from("telegram_users").select("*").order("points", { ascending: false });
    if (selectedGroup !== "all") query = query.eq("chat_id", Number(selectedGroup));
    const { data } = await query;
    setMembers(data || []);
  };

  useEffect(() => {
    supabase.from("telegram_groups").select("chat_id, title").then(({ data }) => setGroups(data || []));
  }, []);

  useEffect(() => { fetchMembers(); }, [selectedGroup]);

  const doAction = async (action: string, member: any) => {
    const key = `${action}_${member.user_id}`;
    setActionLoading(key);
    try {
      const { error } = await supabase.functions.invoke("telegram-admin", {
        body: { action, chat_id: member.chat_id, user_id: member.user_id },
      });
      if (error) throw error;

      // Update local DB
      if (action === "ban") await supabase.from("telegram_users").update({ is_banned: true }).eq("user_id", member.user_id).eq("chat_id", member.chat_id);
      if (action === "unban") await supabase.from("telegram_users").update({ is_banned: false }).eq("user_id", member.user_id).eq("chat_id", member.chat_id);
      if (action === "mute") await supabase.from("telegram_users").update({ is_muted: true }).eq("user_id", member.user_id).eq("chat_id", member.chat_id);
      if (action === "unmute") await supabase.from("telegram_users").update({ is_muted: false }).eq("user_id", member.user_id).eq("chat_id", member.chat_id);
      if (action === "kick") { /* no DB state change needed */ }

      const labels: Record<string, string> = { ban: "حظر", unban: "إلغاء حظر", kick: "طرد", mute: "كتم", unmute: "إلغاء كتم" };
      toast.success(`✅ تم ${labels[action]} ${member.first_name || member.username || member.user_id}`);
      await fetchMembers();
    } catch (e: any) {
      toast.error("❌ فشلت العملية: " + (e.message || "خطأ غير معروف"));
    }
    setActionLoading(null);
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">الأعضاء</h1>
          <p className="text-muted-foreground text-sm mt-1">إدارة أعضاء المجموعات مباشرة</p>
        </div>
        <Select value={selectedGroup} onValueChange={setSelectedGroup}>
          <SelectTrigger className="w-48">
            <SelectValue placeholder="كل المجموعات" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">كل المجموعات</SelectItem>
            {groups.map((g) => (
              <SelectItem key={g.chat_id} value={String(g.chat_id)}>{g.title || g.chat_id}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {members.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-16 text-center">
            <Users className="h-12 w-12 text-muted-foreground mb-4" />
            <p className="text-lg font-medium">لا يوجد أعضاء بعد</p>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="p-0 overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>العضو</TableHead>
                  <TableHead>النقاط</TableHead>
                  <TableHead>المستوى</TableHead>
                  <TableHead>التحذيرات</TableHead>
                  <TableHead>الحالة</TableHead>
                  <TableHead>إجراءات</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {members.map((m) => (
                  <TableRow key={m.id}>
                    <TableCell>
                      <div>
                        <p className="font-medium">{m.first_name || m.username || m.user_id}</p>
                        {m.username && <p className="text-xs text-muted-foreground">@{m.username}</p>}
                      </div>
                    </TableCell>
                    <TableCell>
                      <span className="font-semibold text-primary">{m.points}</span>
                    </TableCell>
                    <TableCell>
                      <Badge variant="secondary">مستوى {m.level}</Badge>
                    </TableCell>
                    <TableCell>
                      <span className={m.warnings > 0 ? "text-destructive font-bold" : ""}>{m.warnings}/3</span>
                    </TableCell>
                    <TableCell>
                      {m.is_banned ? (
                        <Badge variant="destructive">محظور</Badge>
                      ) : m.is_muted ? (
                        <Badge variant="outline" className="border-warning text-warning">مكتوم</Badge>
                      ) : (
                        <Badge variant="outline" className="border-success text-success">نشط</Badge>
                      )}
                    </TableCell>
                    <TableCell>
                      <div className="flex gap-1 flex-wrap">
                        {m.is_banned ? (
                          <Button size="sm" variant="outline" onClick={() => doAction("unban", m)} disabled={actionLoading === `unban_${m.user_id}`} className="text-xs h-7 px-2">
                            إلغاء حظر
                          </Button>
                        ) : (
                          <>
                            <Button size="sm" variant="destructive" onClick={() => doAction("ban", m)} disabled={!!actionLoading} className="text-xs h-7 px-2" title="حظر">
                              <Ban className="h-3 w-3" />
                            </Button>
                            <Button size="sm" variant="outline" onClick={() => doAction("kick", m)} disabled={!!actionLoading} className="text-xs h-7 px-2 text-destructive" title="طرد">
                              <UserX className="h-3 w-3" />
                            </Button>
                            {m.is_muted ? (
                              <Button size="sm" variant="outline" onClick={() => doAction("unmute", m)} disabled={!!actionLoading} className="text-xs h-7 px-2" title="إلغاء كتم">
                                🔊
                              </Button>
                            ) : (
                              <Button size="sm" variant="outline" onClick={() => doAction("mute", m)} disabled={!!actionLoading} className="text-xs h-7 px-2" title="كتم">
                                <VolumeX className="h-3 w-3" />
                              </Button>
                            )}
                          </>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </div>
  );
};

export default MembersPanel;
