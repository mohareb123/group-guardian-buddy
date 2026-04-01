import { Bot, Home, Users, MessageSquare, Shield, Gamepad2, Settings, Menu, X, Zap, ExternalLink, LogOut, Coins, Ticket, Megaphone } from "lucide-react";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import type { PanelId } from "@/pages/Index";

interface Props {
  activePanel: PanelId;
  onPanelChange: (panel: PanelId) => void;
  isOpen: boolean;
  onToggle: () => void;
}

const menuItems: { id: PanelId; label: string; icon: React.ElementType }[] = [
  { id: "home", label: "الرئيسية", icon: Home },
  { id: "groups", label: "المجموعات", icon: MessageSquare },
  { id: "members", label: "الأعضاء", icon: Users },
  { id: "economy", label: "الاقتصاد", icon: Coins },
  { id: "tickets", label: "التذاكر", icon: Ticket },
  { id: "logs", label: "السجلات", icon: Shield },
  { id: "whispers", label: "الهمسات", icon: Zap },
  { id: "entertainment", label: "الترفيه", icon: Gamepad2 },
  { id: "settings", label: "الإعدادات", icon: Settings },
];

const DashboardSidebar = ({ activePanel, onPanelChange, isOpen, onToggle }: Props) => {
  const handleLogout = async () => {
    await supabase.auth.signOut();
    toast.success("تم تسجيل الخروج");
  };

  return (
    <>
      <Button variant="ghost" size="icon" className="fixed top-4 right-4 z-50 md:hidden" onClick={onToggle}>
        {isOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
      </Button>

      <aside className={`fixed md:sticky top-0 right-0 h-screen w-64 bg-sidebar border-l border-sidebar-border flex flex-col z-40 transition-transform duration-300 ${isOpen ? "translate-x-0" : "translate-x-full md:translate-x-0"}`}>
        <div className="flex items-center gap-3 p-6 border-b border-sidebar-border">
          <div className="w-10 h-10 rounded-xl bg-primary flex items-center justify-center">
            <Bot className="h-6 w-6 text-primary-foreground" />
          </div>
          <div>
            <h1 className="text-base font-bold text-sidebar-foreground">بوت المدير</h1>
            <p className="text-xs text-muted-foreground">لوحة التحكم</p>
          </div>
        </div>

        <nav className="flex-1 p-3 space-y-1 overflow-y-auto">
          {menuItems.map((item) => {
            const Icon = item.icon;
            const isActive = activePanel === item.id;
            return (
              <button key={item.id} onClick={() => onPanelChange(item.id)} className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg text-sm font-medium transition-all ${isActive ? "bg-sidebar-accent text-sidebar-primary" : "text-sidebar-foreground hover:bg-sidebar-accent/50"}`}>
                <Icon className="h-5 w-5 shrink-0" />
                <span>{item.label}</span>
              </button>
            );
          })}
        </nav>

        <div className="p-4 border-t border-sidebar-border space-y-3">
          <a href="https://t.me/Groups12Masterbot" target="_blank" rel="noopener noreferrer" className="flex items-center gap-2 text-xs text-sidebar-foreground hover:text-sidebar-primary transition-colors px-2 py-2 rounded-lg hover:bg-sidebar-accent/50">
            <ExternalLink className="h-4 w-4" /><span>رابط البوت على تيليجرام</span>
          </a>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="w-2 h-2 rounded-full bg-success animate-pulse-glow" />
              <span className="text-xs text-muted-foreground">البوت متصل</span>
            </div>
            <Button variant="ghost" size="sm" onClick={handleLogout} className="text-xs h-7 px-2 text-muted-foreground hover:text-destructive">
              <LogOut className="h-3 w-3" />
            </Button>
          </div>
        </div>
      </aside>
    </>
  );
};

export default DashboardSidebar;
