import { useState } from "react";
import DashboardSidebar from "@/components/dashboard/DashboardSidebar";
import DashboardHome from "@/components/dashboard/DashboardHome";
import GroupsPanel from "@/components/dashboard/GroupsPanel";
import MembersPanel from "@/components/dashboard/MembersPanel";
import LogsPanel from "@/components/dashboard/LogsPanel";
import WhispersPanel from "@/components/dashboard/WhispersPanel";
import EntertainmentPanel from "@/components/dashboard/EntertainmentPanel";
import SettingsPanel from "@/components/dashboard/SettingsPanel";
import EconomyPanel from "@/components/dashboard/EconomyPanel";
import TicketsPanel from "@/components/dashboard/TicketsPanel";

export type PanelId = "home" | "groups" | "members" | "logs" | "whispers" | "entertainment" | "settings" | "economy" | "tickets";

const Index = () => {
  const [activePanel, setActivePanel] = useState<PanelId>("home");
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const renderPanel = () => {
    switch (activePanel) {
      case "home": return <DashboardHome />;
      case "groups": return <GroupsPanel />;
      case "members": return <MembersPanel />;
      case "logs": return <LogsPanel />;
      case "whispers": return <WhispersPanel />;
      case "entertainment": return <EntertainmentPanel />;
      case "economy": return <EconomyPanel />;
      case "tickets": return <TicketsPanel />;
      case "settings": return <SettingsPanel />;
      default: return <DashboardHome />;
    }
  };

  return (
    <div className="flex min-h-screen bg-background" dir="rtl">
      <DashboardSidebar
        activePanel={activePanel}
        onPanelChange={(p) => { setActivePanel(p); setSidebarOpen(false); }}
        isOpen={sidebarOpen}
        onToggle={() => setSidebarOpen(!sidebarOpen)}
      />
      <main className="flex-1 overflow-auto">
        <div className="p-4 md:p-6 lg:p-8 max-w-7xl mx-auto">
          {renderPanel()}
        </div>
      </main>
      {sidebarOpen && (
        <div className="fixed inset-0 bg-foreground/20 z-30 md:hidden" onClick={() => setSidebarOpen(false)} />
      )}
    </div>
  );
};

export default Index;
