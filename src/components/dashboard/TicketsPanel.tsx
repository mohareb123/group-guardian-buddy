import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { Ticket, CheckCircle, Clock } from "lucide-react";
import { toast } from "sonner";

const TicketsPanel = () => {
  const [tickets, setTickets] = useState<any[]>([]);

  const fetchTickets = async () => {
    const { data } = await supabase.from("telegram_tickets").select("*").order("created_at", { ascending: false }).limit(50);
    setTickets(data || []);
  };

  useEffect(() => { fetchTickets(); }, []);

  const resolveTicket = async (id: string) => {
    await supabase.from("telegram_tickets").update({ status: "resolved", resolved_at: new Date().toISOString() }).eq("id", id);
    toast.success("✅ تم حل التذكرة");
    fetchTickets();
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">التذاكر</h1>
        <p className="text-muted-foreground text-sm mt-1">إدارة تذاكر الدعم من الأعضاء</p>
      </div>

      <div className="grid grid-cols-3 gap-4">
        <Card>
          <CardContent className="p-4 text-center">
            <p className="text-2xl font-bold">{tickets.length}</p>
            <p className="text-xs text-muted-foreground">الإجمالي</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 text-center">
            <p className="text-2xl font-bold text-warning">{tickets.filter(t => t.status === 'open').length}</p>
            <p className="text-xs text-muted-foreground">مفتوحة</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 text-center">
            <p className="text-2xl font-bold text-success">{tickets.filter(t => t.status === 'resolved').length}</p>
            <p className="text-xs text-muted-foreground">محلولة</p>
          </CardContent>
        </Card>
      </div>

      {tickets.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-16 text-center">
            <Ticket className="h-12 w-12 text-muted-foreground mb-4" />
            <p className="text-lg font-medium">لا توجد تذاكر</p>
            <p className="text-sm text-muted-foreground mt-1">الأعضاء يمكنهم فتح تذاكر بأمر /ticket</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {tickets.map((t) => (
            <Card key={t.id}>
              <CardContent className="p-4">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      {t.status === 'open' ? <Clock className="h-4 w-4 text-warning" /> : <CheckCircle className="h-4 w-4 text-success" />}
                      <span className="font-medium">{t.subject}</span>
                      <Badge variant={t.status === 'open' ? 'default' : 'secondary'}>
                        {t.status === 'open' ? 'مفتوحة' : 'محلولة'}
                      </Badge>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      من: {t.username || t.user_id} • {new Date(t.created_at).toLocaleString("ar")}
                    </p>
                  </div>
                  {t.status === 'open' && (
                    <Button size="sm" variant="outline" onClick={() => resolveTicket(t.id)} className="text-success border-success">
                      <CheckCircle className="h-4 w-4 ml-1" /> حل
                    </Button>
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
};

export default TicketsPanel;
