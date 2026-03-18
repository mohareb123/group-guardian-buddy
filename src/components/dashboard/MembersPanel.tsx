import { useEffect, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { supabase } from "@/integrations/supabase/client";
import { Users } from "lucide-react";

const MembersPanel = () => {
  const [members, setMembers] = useState<any[]>([]);

  useEffect(() => {
    const fetch = async () => {
      const { data } = await supabase.from("telegram_users").select("*").order("points", { ascending: false });
      setMembers(data || []);
    };
    fetch();
  }, []);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">الأعضاء</h1>
        <p className="text-muted-foreground text-sm mt-1">قائمة أعضاء المجموعات مع النقاط والمستويات</p>
      </div>

      {members.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-16 text-center">
            <Users className="h-12 w-12 text-muted-foreground mb-4" />
            <p className="text-lg font-medium">لا يوجد أعضاء بعد</p>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>العضو</TableHead>
                  <TableHead>النقاط</TableHead>
                  <TableHead>المستوى</TableHead>
                  <TableHead>التحذيرات</TableHead>
                  <TableHead>الحالة</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {members.map((m) => (
                  <TableRow key={m.id}>
                    <TableCell>
                      <div>
                        <p className="font-medium">{m.first_name || m.username || m.user_id}</p>
                        {m.username && <p className="text-xs text-muted-foreground">@{m.username}</p>}
                      </div>
                    </TableCell>
                    <TableCell>
                      <span className="font-semibold text-primary">{m.points}</span>
                    </TableCell>
                    <TableCell>
                      <Badge variant="secondary">مستوى {m.level}</Badge>
                    </TableCell>
                    <TableCell>
                      <span className={m.warnings > 0 ? "text-destructive font-bold" : ""}>
                        {m.warnings}/3
                      </span>
                    </TableCell>
                    <TableCell>
                      {m.is_banned ? (
                        <Badge variant="destructive">محظور</Badge>
                      ) : m.is_muted ? (
                        <Badge variant="outline" className="border-warning text-warning">مكتوم</Badge>
                      ) : (
                        <Badge variant="outline" className="border-success text-success">نشط</Badge>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </div>
  );
};

export default MembersPanel;
