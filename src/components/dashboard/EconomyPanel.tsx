import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { Coins, ShoppingBag, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";

const EconomyPanel = () => {
  const [topUsers, setTopUsers] = useState<any[]>([]);
  const [shopItems, setShopItems] = useState<any[]>([]);
  const [purchases, setPurchases] = useState<any[]>([]);
  const [newItem, setNewItem] = useState({ name: "", description: "", price: 100, item_type: "role" });
  const [selectedGroup, setSelectedGroup] = useState<number | null>(null);
  const [groups, setGroups] = useState<any[]>([]);

  useEffect(() => {
    supabase.from("telegram_groups").select("chat_id, title").then(({ data }) => {
      setGroups(data || []);
      if (data && data.length > 0) setSelectedGroup(data[0].chat_id);
    });
  }, []);

  useEffect(() => {
    if (!selectedGroup) return;
    supabase.from("telegram_users").select("*").eq("chat_id", selectedGroup).order("coins", { ascending: false }).limit(20).then(({ data }) => setTopUsers(data || []));
    supabase.from("telegram_shop_items").select("*").eq("chat_id", selectedGroup).then(({ data }) => setShopItems(data || []));
    supabase.from("telegram_purchases").select("*").eq("chat_id", selectedGroup).order("created_at", { ascending: false }).limit(20).then(({ data }) => setPurchases(data || []));
  }, [selectedGroup]);

  const addShopItem = async () => {
    if (!newItem.name || !selectedGroup) return;
    await supabase.from("telegram_shop_items").insert({ ...newItem, chat_id: selectedGroup });
    toast.success("✅ تم إضافة العنصر للمتجر");
    setNewItem({ name: "", description: "", price: 100, item_type: "role" });
    supabase.from("telegram_shop_items").select("*").eq("chat_id", selectedGroup).then(({ data }) => setShopItems(data || []));
  };

  const deleteItem = async (id: string) => {
    await supabase.from("telegram_shop_items").delete().eq("id", id);
    toast.success("تم الحذف");
    setShopItems(shopItems.filter(i => i.id !== id));
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">الاقتصاد والمتجر</h1>
        <p className="text-muted-foreground text-sm mt-1">إدارة العملات والمتجر والمشتريات</p>
      </div>

      {groups.length > 0 && (
        <div className="flex gap-2 flex-wrap">
          {groups.map(g => (
            <Button key={g.chat_id} variant={selectedGroup === g.chat_id ? "default" : "outline"} size="sm" onClick={() => setSelectedGroup(g.chat_id)}>
              {g.title || g.chat_id}
            </Button>
          ))}
        </div>
      )}

      {/* Top Coins */}
      <Card>
        <CardHeader><CardTitle className="text-base flex items-center gap-2"><Coins className="h-4 w-4 text-warning" /> أغنى الأعضاء</CardTitle></CardHeader>
        <CardContent>
          {topUsers.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-4">لا توجد بيانات</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow><TableHead>العضو</TableHead><TableHead>العملات</TableHead><TableHead>السمعة</TableHead><TableHead>الثقة</TableHead></TableRow>
              </TableHeader>
              <TableBody>
                {topUsers.map((u, i) => (
                  <TableRow key={u.id}>
                    <TableCell className="font-medium">{i < 3 ? ['🥇','🥈','🥉'][i] : `${i+1}.`} {u.first_name || u.username || u.user_id}</TableCell>
                    <TableCell><span className="text-warning font-bold">{u.coins || 0} 💰</span></TableCell>
                    <TableCell>{u.reputation || 0} ⭐</TableCell>
                    <TableCell><Badge variant="secondary">مستوى {u.trust_level || 0}</Badge></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Shop Management */}
      <Card>
        <CardHeader><CardTitle className="text-base flex items-center gap-2"><ShoppingBag className="h-4 w-4 text-primary" /> إدارة المتجر</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div className="flex gap-2 flex-wrap">
            <Input placeholder="اسم العنصر" value={newItem.name} onChange={e => setNewItem({...newItem, name: e.target.value})} className="w-40" />
            <Input placeholder="الوصف" value={newItem.description} onChange={e => setNewItem({...newItem, description: e.target.value})} className="w-48" />
            <Input type="number" placeholder="السعر" value={newItem.price} onChange={e => setNewItem({...newItem, price: Number(e.target.value)})} className="w-24" />
            <Button onClick={addShopItem} size="sm"><Plus className="h-4 w-4 ml-1" /> إضافة</Button>
          </div>

          {shopItems.length > 0 && (
            <div className="space-y-2">
              {shopItems.map(item => (
                <div key={item.id} className="flex items-center justify-between p-3 rounded-lg bg-muted/50">
                  <div>
                    <span className="font-medium">{item.name}</span>
                    <span className="text-sm text-muted-foreground mr-2">- {item.price} 💰</span>
                    {item.description && <p className="text-xs text-muted-foreground">{item.description}</p>}
                  </div>
                  <Button variant="ghost" size="sm" onClick={() => deleteItem(item.id)} className="text-destructive"><Trash2 className="h-4 w-4" /></Button>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Recent Purchases */}
      {purchases.length > 0 && (
        <Card>
          <CardHeader><CardTitle className="text-base">آخر المشتريات</CardTitle></CardHeader>
          <CardContent>
            <div className="space-y-2">
              {purchases.map(p => (
                <div key={p.id} className="flex justify-between items-center p-2 rounded bg-muted/50 text-sm">
                  <span>المستخدم {p.user_id} اشترى <b>{p.item_name}</b></span>
                  <span className="text-muted-foreground">{p.price} 💰 • {new Date(p.created_at).toLocaleString("ar")}</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
};

export default EconomyPanel;
