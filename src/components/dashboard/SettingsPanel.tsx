import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Settings } from "lucide-react";

const commands = [
  { cmd: "/start", desc: "بدء استخدام البوت" },
  { cmd: "/help", desc: "عرض قائمة الأوامر" },
  { cmd: "/ban", desc: "حظر عضو (بالرد على رسالته)" },
  { cmd: "/unban", desc: "إلغاء حظر عضو" },
  { cmd: "/kick", desc: "طرد عضو" },
  { cmd: "/mute", desc: "كتم عضو" },
  { cmd: "/unmute", desc: "إلغاء كتم عضو" },
  { cmd: "/warn", desc: "تحذير عضو (3 تحذيرات = طرد)" },
  { cmd: "/unwarn", desc: "إزالة تحذير" },
  { cmd: "/promote", desc: "ترقية عضو لمشرف" },
  { cmd: "/demote", desc: "تخفيض مشرف" },
  { cmd: "/lock links", desc: "منع الروابط" },
  { cmd: "/unlock links", desc: "السماح بالروابط" },
  { cmd: "/lock media", desc: "منع الوسائط" },
  { cmd: "/unlock media", desc: "السماح بالوسائط" },
  { cmd: "/setwelcome", desc: "تعيين رسالة ترحيب" },
  { cmd: "/whisper", desc: "إرسال همسة (بالرد على رسالة عضو)" },
  { cmd: "/quiz", desc: "بدء لعبة أسئلة" },
  { cmd: "/game", desc: "لعبة تخمين الرقم" },
  { cmd: "/truth", desc: "سؤال حقيقة" },
  { cmd: "/dare", desc: "تحدي" },
  { cmd: "/joke", desc: "نكتة عشوائية" },
  { cmd: "/hack", desc: "اختراق وهمي (بالرد)" },
  { cmd: "/points", desc: "عرض نقاطك" },
  { cmd: "/random", desc: "اختيار عضو عشوائي" },
];

const SettingsPanel = () => {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">الإعدادات والأوامر</h1>
        <p className="text-muted-foreground text-sm mt-1">دليل أوامر البوت الكامل</p>
      </div>

      <Card>
        <CardHeader>
          <div className="flex items-center gap-3">
            <Settings className="h-5 w-5 text-primary" />
            <CardTitle className="text-lg">جميع الأوامر</CardTitle>
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid gap-2">
            {commands.map((c) => (
              <div key={c.cmd} className="flex items-center gap-4 p-2 rounded-lg hover:bg-muted/50 transition-colors">
                <code className="bg-muted px-3 py-1 rounded text-sm font-mono min-w-[140px] text-primary">{c.cmd}</code>
                <span className="text-sm text-muted-foreground">{c.desc}</span>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

export default SettingsPanel;
