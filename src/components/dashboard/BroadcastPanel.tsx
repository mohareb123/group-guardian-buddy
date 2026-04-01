import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Megaphone, Send, CheckCircle, XCircle } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

const BroadcastPanel = () => {
  const [message, setMessage] = useState("");
  const [sending, setSending] = useState(false);
  const [groups, setGroups] = useState<any[]>([]);
  const [lastResult, setLastResult] = useState<any>(null);

  useEffect(() => {
    const fetchGroups = async () => {
      const { data } = await supabase.from("telegram_groups").select("chat_id, title");
      setGroups(data || []);
    };
    fetchGroups();
  }, []);

  const handleBroadcast = async () => {
    if (!message.trim()) {
      toast.error("اكتب نص الإشعار أولاً");
      return;
    }

    setSending(true);
    try {
      const { data, error } = await supabase.functions.invoke("telegram-admin", {
        body: { action: "broadcast", text: message.trim() },
      });

      if (error) throw error;

      setLastResult(data);
      toast.success(`تم الإرسال إلى ${data.sent} مجموعة`);
      setMessage("");
    } catch (e: any) {
      toast.error("فشل الإرسال: " + (e.message || "خطأ غير معروف"));
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">البث والإشعارات</h1>
        <p className="text-muted-foreground text-sm mt-1">أرسل إشعارات هامة لجميع المجموعات</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Megaphone className="h-5 w-5 text-primary" />
            إرسال إشعار عام
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <p className="text-sm text-muted-foreground mb-2">
              المجموعات المستهدفة: <Badge variant="secondary">{groups.length} مجموعة</Badge>
            </p>
          </div>
          <Textarea
            placeholder="اكتب نص الإشعار هنا... (يدعم HTML)"
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            rows={5}
            className="resize-none"
          />
          <div className="flex items-center justify-between">
            <p className="text-xs text-muted-foreground">
              سيتم إرسال الإشعار مع عنوان "📢 إشعار هام" لجميع المجموعات
            </p>
            <Button onClick={handleBroadcast} disabled={sending || !message.trim()}>
              {sending ? "جاري الإرسال..." : (
                <><Send className="h-4 w-4 ml-2" /> إرسال</>
              )}
            </Button>
          </div>
        </CardContent>
      </Card>

      {lastResult && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">نتيجة آخر إرسال</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex gap-4 mb-4">
              <div className="flex items-center gap-2">
                <CheckCircle className="h-4 w-4 text-success" />
                <span className="text-sm">تم الإرسال: {lastResult.sent}</span>
              </div>
              {lastResult.failed > 0 && (
                <div className="flex items-center gap-2">
                  <XCircle className="h-4 w-4 text-destructive" />
                  <span className="text-sm">فشل: {lastResult.failed}</span>
                </div>
              )}
            </div>
            {lastResult.results && (
              <div className="space-y-2">
                {lastResult.results.map((r: any, i: number) => (
                  <div key={i} className="flex items-center justify-between text-sm p-2 bg-muted/50 rounded">
                    <span>{r.title || r.chat_id}</span>
                    <Badge variant={r.status === "sent" ? "default" : "destructive"}>
                      {r.status === "sent" ? "تم" : "فشل"}
                    </Badge>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
};

export default BroadcastPanel;
