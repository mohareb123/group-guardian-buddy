import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Settings, Bot, Shield, Gamepad2, Info, Megaphone, Coins, Scale, FileText, Brain, Lock, Clock } from "lucide-react";

const commandSections = [
  {
    title: "🤖 الذكاء الاصطناعي (فادي)",
    icon: Bot,
    commands: [
      { cmd: 'اذكر "فادي"', desc: "فادي يفهم ويتصرف تلقائياً" },
      { cmd: "مثال: يا فادي احظر", desc: "بالرد على رسالة الشخص" },
    ],
  },
  {
    title: "👑 أوامر الإدارة",
    icon: Shield,
    commands: [
      { cmd: "/ban /unban", desc: "حظر/إلغاء حظر" },
      { cmd: "/kick", desc: "طرد عضو" },
      { cmd: "/mute /unmute", desc: "كتم/إلغاء كتم" },
      { cmd: "/warn /unwarn", desc: "تحذير (3=طرد)" },
      { cmd: "/promote /demote", desc: "ترقية/تخفيض" },
      { cmd: "/pin /unpin", desc: "تثبيت رسالة" },
      { cmd: "/report", desc: "إبلاغ عن مخالفة" },
    ],
  },
  {
    title: "🔒 حماية متقدمة",
    icon: Lock,
    commands: [
      { cmd: "/lock /unlock", desc: "قفل links|media|stickers|files" },
      { cmd: "/antispam on|off", desc: "مضاد السبام (كتم تلقائي)" },
      { cmd: "/antiflood 5 3", desc: "مضاد الفيضان (5 رسائل/3 ثوانٍ)" },
      { cmd: "/captcha on|off", desc: "كابتشا + طرد تلقائي بعد دقيقتين" },
      { cmd: "/toxicity on|off", desc: "فلتر المحتوى السام بالـ AI" },
      { cmd: "/blacklist add|remove|clear", desc: "كلمات محظورة (حذف تلقائي)" },
      { cmd: "/restrict_new 7|off", desc: "تقييد الحسابات الجديدة (نص فقط)" },
      { cmd: "/nightmode 23 6", desc: "وضع ليلي (حذف رسائل)" },
      { cmd: "/slowmode 30", desc: "وضع بطيء (ثواني)" },
      { cmd: "/security", desc: "عرض حالة جميع أنظمة الحماية" },
    ],
  },
  {
    title: "💰 النظام الاقتصادي",
    icon: Coins,
    commands: [
      { cmd: "/daily", desc: "مكافأة يومية (سلسلة أيام)" },
      { cmd: "/coins /wallet", desc: "عرض رصيدك" },
      { cmd: "/transfer 100", desc: "تحويل عملات (بالرد)" },
      { cmd: "/shop", desc: "عرض المتجر" },
      { cmd: "/buy 1", desc: "شراء عنصر بالرقم" },
    ],
  },
  {
    title: "🏆 التحديات والسمعة",
    icon: Scale,
    commands: [
      { cmd: "/challenge", desc: "تحدي اليوم" },
      { cmd: "/mychallenges", desc: "تقدمك في التحدي" },
      { cmd: "/reputation /rep", desc: "إعطاء سمعة (بالرد)" },
      { cmd: "/trust", desc: "مستوى الثقة" },
      { cmd: "/profile", desc: "بروفايل كامل" },
    ],
  },
  {
    title: "⚖️ المحكمة والتذاكر",
    icon: Scale,
    commands: [
      { cmd: "/court سبب", desc: "تقديم عضو للمحكمة (تصويت)" },
      { cmd: "/ticket موضوع", desc: "فتح تذكرة دعم" },
    ],
  },
  {
    title: "📝 أدوات ذكية",
    icon: FileText,
    commands: [
      { cmd: "/addfaq سؤال|إجابة|كلمات", desc: "إضافة FAQ" },
      { cmd: "/faq", desc: "عرض الأسئلة الشائعة" },
      { cmd: "/save", desc: "حفظ رسالة (بالرد)" },
      { cmd: "/saved", desc: "عرض المحفوظات" },
      { cmd: "/schedule 30m رسالة", desc: "جدولة رسالة" },
    ],
  },
  {
    title: "📢 النداء",
    icon: Megaphone,
    commands: [
      { cmd: "/tagall /all", desc: "نداء جميع الأعضاء بإشعار" },
    ],
  },
  {
    title: "💻 تشغيل الأكواد",
    icon: Brain,
    commands: [
      { cmd: "/run python <code>", desc: "تشغيل بايثون فعلياً (Piston)" },
      { cmd: "/run js <code>", desc: "تشغيل JavaScript / Node" },
      { cmd: "/run typescript", desc: "تشغيل TypeScript" },
      { cmd: "/run bash", desc: "تشغيل أوامر Bash" },
    ],
  },
  {
    title: "📥 تحميل الفيديوهات",
    icon: Megaphone,
    commands: [
      { cmd: "/download <url>", desc: "تنزيل فيديو من TikTok/YT/IG" },
    ],
  },
  {
    title: "🛠️ أوامر المطور",
    icon: Lock,
    commands: [
      { cmd: "/send <id> <msg>", desc: "إرسال لمستخدم محدد" },
      { cmd: "/sendmulti 1,2,3 <msg>", desc: "إرسال لعدة مستخدمين" },
      { cmd: "/broadcast <msg>", desc: "بث لكل المجموعات" },
      { cmd: "/togglefeature <name> on|off", desc: "تفعيل/تعطيل ميزة حماية" },
      { cmd: "/retry", desc: "إعادة الرسائل المجدولة الفاشلة" },
    ],
  },
  {
    title: "🎮 الترفيه",
    icon: Gamepad2,
    commands: [
      { cmd: "/quiz", desc: "أسئلة (+عملات)" },
      { cmd: "/game", desc: "تخمين رقم (+عملات)" },
      { cmd: "/truth /dare", desc: "حقيقة أم تحدي" },
      { cmd: "/joke", desc: "نكتة" },
      { cmd: "/hack", desc: "اختراق وهمي" },
      { cmd: "/whisper", desc: "همسة سرية" },
      { cmd: "/roll /flip /random", desc: "نرد/عملة/عشوائي" },
    ],
  },
  {
    title: "ℹ️ معلومات",
    icon: Info,
    commands: [
      { cmd: "/id /info", desc: "معلومات عضو" },
      { cmd: "/top /points /stats", desc: "إحصائيات" },
      { cmd: "/dev", desc: "المطور" },
    ],
  },
];

const SettingsPanel = () => {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">الإعدادات والأوامر</h1>
        <p className="text-muted-foreground text-sm mt-1">دليل أوامر البوت الكامل - 20+ ميزة</p>
      </div>

      {commandSections.map((section) => (
        <Card key={section.title}>
          <CardHeader className="pb-2">
            <div className="flex items-center gap-3">
              <section.icon className="h-5 w-5 text-primary" />
              <CardTitle className="text-base">{section.title}</CardTitle>
            </div>
          </CardHeader>
          <CardContent>
            <div className="grid gap-1.5">
              {section.commands.map((c) => (
                <div key={c.cmd} className="flex items-center gap-4 p-2 rounded-lg hover:bg-muted/50 transition-colors">
                  <code className="bg-muted px-2 py-1 rounded text-xs font-mono min-w-[140px] text-primary">{c.cmd}</code>
                  <span className="text-xs text-muted-foreground">{c.desc}</span>
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
