import { useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Bot, LogIn, UserPlus } from "lucide-react";
import { toast } from "sonner";

const Login = () => {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [isSignup, setIsSignup] = useState(false);
  const navigate = useNavigate();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    if (isSignup) {
      const { error } = await supabase.auth.signUp({ email, password });
      if (error) {
        toast.error("فشل إنشاء الحساب: " + error.message);
      } else {
        toast.success("تم إنشاء الحساب! سجل دخولك الآن");
        navigate("/");
      }
    } else {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) {
        toast.error("فشل تسجيل الدخول: " + error.message);
      } else {
        toast.success("تم تسجيل الدخول بنجاح!");
        navigate("/");
      }
    }
    setLoading(false);
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4" dir="rtl">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center space-y-4">
          <div className="mx-auto w-16 h-16 rounded-2xl bg-primary flex items-center justify-center">
            <Bot className="h-10 w-10 text-primary-foreground" />
          </div>
          <CardTitle className="text-2xl">بوت المدير</CardTitle>
          <p className="text-sm text-muted-foreground">
            {isSignup ? "أنشئ حسابك للوصول إلى لوحة التحكم" : "سجل دخولك للوصول إلى لوحة التحكم"}
          </p>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">البريد الإلكتروني</label>
              <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="admin@example.com" required dir="ltr" />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">كلمة المرور</label>
              <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" required dir="ltr" minLength={6} />
            </div>
            <Button type="submit" className="w-full" disabled={loading}>
              {loading ? "جاري المعالجة..." : isSignup ? (
                <><UserPlus className="h-4 w-4 ml-2" /> إنشاء حساب</>
              ) : (
                <><LogIn className="h-4 w-4 ml-2" /> تسجيل الدخول</>
              )}
            </Button>
          </form>
          <div className="mt-4 text-center">
            <button onClick={() => setIsSignup(!isSignup)} className="text-sm text-primary hover:underline">
              {isSignup ? "لديك حساب؟ سجل الدخول" : "ليس لديك حساب؟ أنشئ واحد"}
            </button>
          </div>
          <div className="mt-4 text-center">
            <a href="https://t.me/Groups12Masterbot" target="_blank" rel="noopener noreferrer" className="text-sm text-primary hover:underline">
              🤖 رابط البوت على تيليجرام
            </a>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

export default Login;
