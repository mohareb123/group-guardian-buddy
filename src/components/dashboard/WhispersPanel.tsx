import { useEffect, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { Zap } from "lucide-react";

const WhispersPanel = () => {
  const [whispers, setWhispers] = useState<any[]>([]);

  useEffect(() => {
    const fetch = async () => {
      const { data } = await supabase
        .from("telegram_whispers")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(50);
      setWhispers(data || []);
    };
    fetch();
  }, []);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">الهمسات</h1>
        <p className="text-muted-foreground text-sm mt-1">سجل الرسائل السرية بين الأعضاء</p>
      </div>

      {whispers.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-16 text-center">
            <Zap className="h-12 w-12 text-muted-foreground mb-4" />
            <p className="text-lg font-medium">لا توجد همسات بعد</p>
            <p className="text-sm text-muted-foreground mt-1">استخدم /whisper في المجموعة لإرسال همسة</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {whispers.map((w) => (
            <Card key={w.id}>
              <CardContent className="p-4">
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium">{w.from_username || w.from_user_id}</span>
                    <span className="text-xs text-muted-foreground">→</span>
                    <span className="text-sm font-medium">{w.to_username || w.to_user_id}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge variant={w.is_read ? "secondary" : "default"}>
                      {w.is_read ? "مقروءة" : "غير مقروءة"}
                    </Badge>
                    <span className="text-xs text-muted-foreground">
                      {new Date(w.created_at).toLocaleString("ar")}
                    </span>
                  </div>
                </div>
                <p className="text-sm bg-muted/50 p-3 rounded-lg">{w.message}</p>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
};

export default WhispersPanel;
