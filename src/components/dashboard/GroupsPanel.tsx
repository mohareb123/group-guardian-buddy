import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { MessageSquare, Save } from "lucide-react";
import { toast } from "sonner";

const GroupsPanel = () => {
  const [groups, setGroups] = useState<any[]>([]);

  const fetchGroups = async () => {
    const { data } = await supabase.from("telegram_groups").select("*").order("created_at", { ascending: false });
    setGroups(data || []);
  };

  useEffect(() => { fetchGroups(); }, []);

  const toggleSetting = async (chatId: number, field: string, value: boolean) => {
    await supabase.from("telegram_groups").update({ [field]: value }).eq("chat_id", chatId);
    toast.success("✅ تم التحديث");
    fetchGroups();
  };

  const updateWelcome = async (chatId: number, message: string) => {
    await supabase.from("telegram_groups").update({ welcome_message: message }).eq("chat_id", chatId);
    toast.success("✅ تم تحديث رسالة الترحيب");
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">المجموعات</h1>
        <p className="text-muted-foreground text-sm mt-1">تحكم مباشر في إعدادات المجموعات</p>
      </div>

      {groups.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-16 text-center">
            <MessageSquare className="h-12 w-12 text-muted-foreground mb-4" />
            <p className="text-lg font-medium">لا توجد مجموعات بعد</p>
            <p className="text-sm text-muted-foreground mt-1">أضف البوت إلى مجموعة تيليجرام وسيتم إضافتها تلقائياً</p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4">
          {groups.map((group) => (
            <Card key={group.id}>
              <CardHeader>
                <CardTitle className="text-base">{group.title || `مجموعة ${group.chat_id}`}</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  {[
                    { label: "منع الروابط", field: "lock_links", value: group.lock_links },
                    { label: "منع الوسائط", field: "lock_media", value: group.lock_media },
                    { label: "منع الملصقات", field: "lock_stickers", value: group.lock_stickers },
                    { label: "منع الملفات", field: "lock_files", value: group.lock_files },
                    { label: "مضاد السبام", field: "anti_spam", value: group.anti_spam },
                    { label: "الترفيه", field: "entertainment_enabled", value: group.entertainment_enabled },
                  ].map((s) => (
                    <div key={s.field} className="flex items-center justify-between">
                      <span className="text-sm">{s.label}</span>
                      <Switch checked={!!s.value} onCheckedChange={(v) => toggleSetting(group.chat_id, s.field, v)} />
                    </div>
                  ))}
                </div>
                <div className="pt-2 border-t space-y-2">
                  <p className="text-xs text-muted-foreground">رسالة الترحيب:</p>
                  <div className="flex gap-2">
                    <Input
                      defaultValue={group.welcome_message || ""}
                      id={`welcome-${group.chat_id}`}
                      className="flex-1"
                    />
                    <Button
                      size="sm"
                      onClick={() => {
                        const el = document.getElementById(`welcome-${group.chat_id}`) as HTMLInputElement;
                        if (el) updateWelcome(group.chat_id, el.value);
                      }}
                    >
                      <Save className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
};

export default GroupsPanel;
