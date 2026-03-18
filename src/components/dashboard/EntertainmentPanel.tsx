import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Gamepad2, HelpCircle, Laugh, Swords, Sparkles } from "lucide-react";

const features = [
  { title: "أسئلة Quiz", desc: "أسئلة متنوعة للأعضاء مع نظام نقاط", icon: HelpCircle, cmd: "/quiz" },
  { title: "تخمين الرقم", desc: "لعبة تخمين رقم عشوائي", icon: Gamepad2, cmd: "/game" },
  { title: "حقيقة أم تحدي", desc: "أسئلة حقيقة أم تحدي ممتعة", icon: Swords, cmd: "/truth, /dare" },
  { title: "نكت عشوائية", desc: "نكت مضحكة للمجموعة", icon: Laugh, cmd: "/joke" },
  { title: "الهكر الوهمي", desc: "محاكاة اختراق وهمي مضحك", icon: Sparkles, cmd: "/hack" },
];

const EntertainmentPanel = () => {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">الترفيه</h1>
        <p className="text-muted-foreground text-sm mt-1">ميزات الترفيه المتاحة في المجموعات</p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        {features.map((f) => {
          const Icon = f.icon;
          return (
            <Card key={f.title}>
              <CardHeader className="pb-2">
                <div className="flex items-center gap-3">
                  <div className="p-2 rounded-lg bg-accent">
                    <Icon className="h-5 w-5 text-accent-foreground" />
                  </div>
                  <CardTitle className="text-base">{f.title}</CardTitle>
                </div>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-muted-foreground">{f.desc}</p>
                <code className="mt-2 inline-block text-xs bg-muted px-2 py-1 rounded">{f.cmd}</code>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
};

export default EntertainmentPanel;
