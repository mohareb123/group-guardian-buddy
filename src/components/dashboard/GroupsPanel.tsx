import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { supabase } from "@/integrations/supabase/client";
import { MessageSquare } from "lucide-react";

const GroupsPanel = () => {
  const [groups, setGroups] = useState<any[]>([]);

  useEffect(() => {
    const fetch = async () => {
      const { data } = await supabase.from("telegram_groups").select("*").order("created_at", { ascending: false });
      setGroups(data || []);
    };
    fetch();
  }, []);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">المجموعات</h1>
        <p className="text-muted-foreground text-sm mt-1">إدارة المجموعات المتصلة بالبوت</p>
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
                  <div className="flex items-center justify-between">
                    <span className="text-sm">منع الروابط</span>
                    <Switch checked={group.lock_links} disabled />
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-sm">منع الوسائط</span>
                    <Switch checked={group.lock_media} disabled />
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-sm">منع السبام</span>
                    <Switch checked={group.anti_spam} disabled />
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-sm">الترفيه</span>
                    <Switch checked={group.entertainment_enabled} disabled />
                  </div>
                </div>
                <div className="pt-2 border-t">
                  <p className="text-xs text-muted-foreground mb-1">رسالة الترحيب:</p>
                  <p className="text-sm bg-muted/50 p-3 rounded-lg">{group.welcome_message}</p>
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
