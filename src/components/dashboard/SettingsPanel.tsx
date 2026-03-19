import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Settings, Bot, Shield, Gamepad2, Info, Megaphone } from "lucide-react";

const commandSections = [
  {
    title: "🤖 الذكاء الاصطناعي (فادي)",
    icon: Bot,
    commands: [
      { cmd: 'اذكر "فادي"', desc: "فادي يفهم ويتصرف تلقائياً - حظر، طرد، كتم، أو حتى محادثة عادية" },
      { cmd: "مثال: يا فادي احظر", desc: "بالرد على رسالة الشخص المراد حظره" },
      { cmd: "مثال: يا فادي نكتة", desc: "يرد بنكتة مضحكة" },
    ],
  },
  {
    title: "👑 أوامر الإدارة",
    icon: Shield,
    commands: [
      { cmd: "/ban", desc: "حظر عضو (بالرد على رسالته)" },
      { cmd: "/unban", desc: "إلغاء حظر عضو" },
      { cmd: "/kick", desc: "طرد عضو" },
      { cmd: "/mute", desc: "كتم عضو" },
      { cmd: "/unmute", desc: "إلغاء كتم عضو" },
      { cmd: "/warn", desc: "تحذير عضو (3 تحذيرات = طرد)" },
      { cmd: "/unwarn", desc: "إزالة تحذير" },
      { cmd: "/promote", desc: "ترقية عضو لمشرف" },
      { cmd: "/demote", desc: "تخفيض مشرف" },
      { cmd: "/pin", desc: "تثبيت رسالة" },
      { cmd: "/unpin", desc: "إلغاء تثبيت" },
      { cmd: "/report", desc: "إبلاغ عن مخالفة (بالرد)" },
    ],
  },
  {
    title: "🔒 الحماية والإعدادات",
    icon: Settings,
    commands: [
      { cmd: "/lock links|media|stickers|files", desc: "قفل نوع محتوى" },
      { cmd: "/unlock links|media|stickers|files", desc: "فتح نوع محتوى" },
      { cmd: "/antispam on|off", desc: "تشغيل/إيقاف مضاد السبام" },
      { cmd: "/setwelcome", desc: "تعيين رسالة ترحيب" },
    ],
  },
  {
    title: "📢 النداء",
    icon: Megaphone,
    commands: [
      { cmd: "/tagall", desc: "نداء جميع الأعضاء (يذكر الكل)" },
      { cmd: "/all", desc: "نداء سريع" },
    ],
  },
  {
    title: "🎮 الترفيه",
    icon: Gamepad2,
    commands: [
      { cmd: "/quiz", desc: "بدء لعبة أسئلة" },
      { cmd: "/game", desc: "لعبة تخمين الرقم" },
      { cmd: "/truth", desc: "سؤال حقيقة" },
      { cmd: "/dare", desc: "تحدي" },
      { cmd: "/joke", desc: "نكتة عشوائية" },
      { cmd: "/hack", desc: "اختراق وهمي (بالرد)" },
      { cmd: "/whisper", desc: "إرسال همسة (بالرد)" },
      { cmd: "/points", desc: "عرض نقاطك" },
      { cmd: "/top", desc: "أعلى 10 أعضاء" },
      { cmd: "/random", desc: "اختيار عضو عشوائي" },
      { cmd: "/roll", desc: "رمي نرد" },
      { cmd: "/flip", desc: "قلب عملة" },
    ],
  },
  {
    title: "ℹ️ معلومات",
    icon: Info,
    commands: [
      { cmd: "/id", desc: "عرض معرفك أو معرف عضو" },
      { cmd: "/info", desc: "معلومات تفصيلية عن عضو" },
      { cmd: "/dev", desc: "التواصل مع المطور" },
      { cmd: "/start", desc: "بدء استخدام البوت" },
      { cmd: "/help", desc: "عرض قائمة الأوامر" },
    ],
  },
];

const SettingsPanel = () => {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">الإعدادات والأوامر</h1>
        <p className="text-muted-foreground text-sm mt-1">دليل أوامر البوت الكامل مع الذكاء الاصطناعي</p>
      </div>

      {commandSections.map((section) => (
        <Card key={section.title}>
          <CardHeader>
            <div className="flex items-center gap-3">
              <section.icon className="h-5 w-5 text-primary" />
              <CardTitle className="text-lg">{section.title}</CardTitle>
            </div>
          </CardHeader>
          <CardContent>
            <div className="grid gap-2">
              {section.commands.map((c) => (
                <div key={c.cmd} className="flex items-center gap-4 p-2 rounded-lg hover:bg-muted/50 transition-colors">
                  <code className="bg-muted px-3 py-1 rounded text-sm font-mono min-w-[180px] text-primary">{c.cmd}</code>
                  <span className="text-sm text-muted-foreground">{c.desc}</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
};

export default SettingsPanel;
