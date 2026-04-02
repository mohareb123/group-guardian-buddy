import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Megaphone, Send, CheckCircle, XCircle, Upload, Plus, Trash2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

type MessageType = "text" | "photo" | "video" | "audio" | "document" | "poll" | "sticker";
type TargetAudience = "groups" | "users" | "all";

const BroadcastPanel = () => {
  const [messageType, setMessageType] = useState<MessageType>("text");
  const [target, setTarget] = useState<TargetAudience>("groups");
  const [caption, setCaption] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [stickerFileId, setStickerFileId] = useState("");
  const [pollQuestion, setPollQuestion] = useState("");
  const [pollOptions, setPollOptions] = useState(["", ""]);
  const [sending, setSending] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [groups, setGroups] = useState<any[]>([]);
  const [usersCount, setUsersCount] = useState(0);
  const [lastResult, setLastResult] = useState<any>(null);

  useEffect(() => {
    const fetch = async () => {
      const { data: g } = await supabase.from("telegram_groups").select("chat_id, title");
      setGroups(g || []);
      const { count } = await supabase.from("telegram_users").select("*", { count: "exact", head: true });
      setUsersCount(count || 0);
    };
    fetch();
  }, []);

  const uploadFile = async (f: File): Promise<string> => {
    setUploading(true);
    try {
      const ext = f.name.split(".").pop();
      const path = `${Date.now()}_${Math.random().toString(36).slice(2)}.${ext}`;
      const { error } = await supabase.storage.from("broadcast-media").upload(path, f);
      if (error) throw error;
      const { data } = supabase.storage.from("broadcast-media").getPublicUrl(path);
      return data.publicUrl;
    } finally {
      setUploading(false);
    }
  };

  const handleBroadcast = async () => {
    if (messageType === "text" && !caption.trim()) {
      toast.error("اكتب نص الإشعار أولاً");
      return;
    }
    if (["photo", "video", "audio", "document"].includes(messageType) && !file) {
      toast.error("ارفع الملف أولاً");
      return;
    }
    if (messageType === "poll" && (!pollQuestion.trim() || pollOptions.filter(o => o.trim()).length < 2)) {
      toast.error("اكتب السؤال وخيارين على الأقل");
      return;
    }
    if (messageType === "sticker" && !stickerFileId.trim()) {
      toast.error("أدخل معرف الملصق (file_id)");
      return;
    }

    setSending(true);
    try {
      let fileUrl = "";
      if (file && ["photo", "video", "audio", "document"].includes(messageType)) {
        fileUrl = await uploadFile(file);
      }

      const body: any = {
        action: "broadcast_media",
        type: messageType,
        target,
        caption: caption.trim(),
      };

      if (fileUrl) body.file_url = fileUrl;
      if (messageType === "sticker") body.sticker_file_id = stickerFileId.trim();
      if (messageType === "poll") {
        body.poll_question = pollQuestion.trim();
        body.poll_options = pollOptions.filter(o => o.trim());
      }

      const { data, error } = await supabase.functions.invoke("telegram-admin", { body });
      if (error) throw error;

      setLastResult(data);
      toast.success(`تم الإرسال إلى ${data.sent} جهة`);
      setCaption("");
      setFile(null);
      setPollQuestion("");
      setPollOptions(["", ""]);
      setStickerFileId("");
    } catch (e: any) {
      toast.error("فشل الإرسال: " + (e.message || "خطأ غير معروف"));
    } finally {
      setSending(false);
    }
  };

  const targetLabel = target === "groups" ? `${groups.length} مجموعة` : target === "users" ? `${usersCount} مستخدم` : `${groups.length} مجموعة + ${usersCount} مستخدم`;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">البث والإشعارات</h1>
        <p className="text-muted-foreground text-sm mt-1">أرسل إشعارات متنوعة لجميع المجموعات والمستخدمين</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Megaphone className="h-5 w-5 text-primary" />
            إرسال إشعار
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Type & Target */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="text-sm font-medium mb-1 block">نوع الإشعار</label>
              <Select value={messageType} onValueChange={(v) => setMessageType(v as MessageType)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="text">📝 نص</SelectItem>
                  <SelectItem value="photo">📷 صورة</SelectItem>
                  <SelectItem value="video">🎬 فيديو</SelectItem>
                  <SelectItem value="audio">🎵 صوت</SelectItem>
                  <SelectItem value="document">📎 ملف</SelectItem>
                  <SelectItem value="poll">📊 استفتاء</SelectItem>
                  <SelectItem value="sticker">🏷️ ملصق</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-sm font-medium mb-1 block">الجمهور المستهدف</label>
              <Select value={target} onValueChange={(v) => setTarget(v as TargetAudience)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="groups">المجموعات فقط</SelectItem>
                  <SelectItem value="users">المستخدمين فقط</SelectItem>
                  <SelectItem value="all">الكل</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <p className="text-sm text-muted-foreground">
            المستهدفون: <Badge variant="secondary">{targetLabel}</Badge>
          </p>

          {/* File upload */}
          {["photo", "video", "audio", "document"].includes(messageType) && (
            <div>
              <label className="text-sm font-medium mb-1 block">
                {messageType === "photo" ? "ارفع صورة" : messageType === "video" ? "ارفع فيديو" : messageType === "audio" ? "ارفع ملف صوتي" : "ارفع ملف"}
              </label>
              <div className="flex items-center gap-2">
                <Input
                  type="file"
                  accept={messageType === "photo" ? "image/*" : messageType === "video" ? "video/*" : messageType === "audio" ? "audio/*" : "*"}
                  onChange={(e) => setFile(e.target.files?.[0] || null)}
                  className="flex-1"
                />
                {file && (
                  <Badge variant="outline" className="shrink-0">
                    {(file.size / 1024 / 1024).toFixed(1)} MB
                  </Badge>
                )}
              </div>
            </div>
          )}

          {/* Sticker */}
          {messageType === "sticker" && (
            <div>
              <label className="text-sm font-medium mb-1 block">معرف الملصق (file_id)</label>
              <Input
                value={stickerFileId}
                onChange={(e) => setStickerFileId(e.target.value)}
                placeholder="أرسل الملصق للبوت في الخاص واحصل على الـ file_id"
                dir="ltr"
              />
            </div>
          )}

          {/* Poll */}
          {messageType === "poll" && (
            <div className="space-y-3">
              <div>
                <label className="text-sm font-medium mb-1 block">سؤال الاستفتاء</label>
                <Input value={pollQuestion} onChange={(e) => setPollQuestion(e.target.value)} placeholder="ما رأيكم في...؟" />
              </div>
              <div>
                <label className="text-sm font-medium mb-1 block">الخيارات</label>
                <div className="space-y-2">
                  {pollOptions.map((opt, i) => (
                    <div key={i} className="flex items-center gap-2">
                      <Input
                        value={opt}
                        onChange={(e) => { const n = [...pollOptions]; n[i] = e.target.value; setPollOptions(n); }}
                        placeholder={`الخيار ${i + 1}`}
                      />
                      {pollOptions.length > 2 && (
                        <Button size="icon" variant="ghost" onClick={() => setPollOptions(pollOptions.filter((_, j) => j !== i))}>
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      )}
                    </div>
                  ))}
                  {pollOptions.length < 10 && (
                    <Button size="sm" variant="outline" onClick={() => setPollOptions([...pollOptions, ""])}>
                      <Plus className="h-4 w-4 ml-1" /> إضافة خيار
                    </Button>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* Caption / text */}
          {messageType !== "poll" && messageType !== "sticker" && (
            <Textarea
              placeholder={messageType === "text" ? "اكتب نص الإشعار هنا... (يدعم HTML)" : "تعليق (اختياري)..."}
              value={caption}
              onChange={(e) => setCaption(e.target.value)}
              rows={4}
              className="resize-none"
            />
          )}

          <div className="flex items-center justify-end">
            <Button onClick={handleBroadcast} disabled={sending || uploading}>
              {uploading ? "جاري الرفع..." : sending ? "جاري الإرسال..." : (
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
                <CheckCircle className="h-4 w-4 text-green-500" />
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
              <div className="space-y-2 max-h-60 overflow-y-auto">
                {lastResult.results.map((r: any, i: number) => (
                  <div key={i} className="flex items-center justify-between text-sm p-2 bg-muted/50 rounded">
                    <span className="truncate flex-1">{r.title || r.chat_id || r.user_id}</span>
                    <Badge variant={r.status === "sent" ? "default" : "destructive"} className="mr-2">
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
