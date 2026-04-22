"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  getOrders,
  getOrderStats,
  connectOrderStream,
  Order,
  OrderStats,
} from "@/lib/api";
import {
  formatRupiah,
  formatTime,
  getStatusLabel,
  getStatusColor,
  getPaymentStatusLabel,
  getPaymentStatusColor,
  formatWhatsAppLink,
} from "@/lib/helpers";
import {
  Package,
  Truck,
  CheckCircle2,
  Clock,
  Phone,
  MapPin,
  RefreshCw,
  ShoppingBag,
  TrendingUp,
} from "lucide-react";
import { toast } from "sonner";
import { OrderDetailModal } from "@/components/order-detail-modal";

const filterTabs = [
  { key: "all", label: "Semua" },
  { key: "new", label: "Baru" },
  { key: "process", label: "Dibuat" },
  { key: "delivery", label: "Diantar" },
  { key: "done", label: "Selesai" },
];

const statusMap: Record<string, string> = {
  new: "awaiting_payment,ready_to_submit",
  process: "preparing",
  delivery: "on_the_way,ready_for_pickup",
  done: "completed",
};

function StatSkeleton() {
  return (
    <Card className="border-border/50">
      <CardContent className="p-4">
        <div className="flex items-center gap-3">
          <Skeleton className="w-10 h-10 rounded-xl bg-secondary" />
          <div className="space-y-2">
            <Skeleton className="h-6 w-10 bg-secondary" />
            <Skeleton className="h-3 w-20 bg-secondary" />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function OrderSkeleton() {
  return (
    <Card className="border-border/50">
      <CardContent className="p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1 space-y-3">
            <div className="flex items-center gap-2">
              <Skeleton className="h-5 w-28 bg-secondary" />
              <Skeleton className="h-4 w-12 bg-secondary" />
            </div>
            <Skeleton className="h-3.5 w-40 bg-secondary" />
            <Skeleton className="h-4 w-56 bg-secondary" />
            <div className="flex gap-2">
              <Skeleton className="h-5 w-20 rounded-full bg-secondary" />
              <Skeleton className="h-5 w-16 rounded-full bg-secondary" />
            </div>
          </div>
          <div className="space-y-2">
            <Skeleton className="h-5 w-20 bg-secondary ml-auto" />
            <Skeleton className="h-3 w-12 bg-secondary ml-auto" />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

export default function DashboardPage() {
  const [stats, setStats] = useState<OrderStats | null>(null);
  const [orders, setOrders] = useState<Order[]>([]);
  const [activeFilter, setActiveFilter] = useState("all");
  const [loading, setLoading] = useState(true);
  const [statsLoading, setStatsLoading] = useState(true);
  const [selectedOrder, setSelectedOrder] = useState<Order | null>(null);
  const ordersRef = useRef<Order[]>([]);

  const fetchStats = useCallback(async () => {
    try {
      setStatsLoading(true);
      const res = await getOrderStats();
      setStats(res.data);
    } catch {
      // silent
    } finally {
      setStatsLoading(false);
    }
  }, []);

  const fetchOrders = useCallback(async (filter: string) => {
    try {
      setLoading(true);
      const params: Record<string, string | number> = {
        per_page: 50,
        sort: "created_at",
        order: "desc",
      };
      if (filter !== "all" && statusMap[filter]) {
        params.status = statusMap[filter];
      }
      const res = await getOrders(params);
      setOrders(res.data);
      ordersRef.current = res.data;
    } catch {
      toast.error("Gagal memuat pesanan");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchStats();
    fetchOrders(activeFilter);
  }, [activeFilter, fetchStats, fetchOrders]);

  // SSE realtime
  useEffect(() => {
    const cleanup = connectOrderStream(
      (newOrder) => {
        toast.success(`Pesanan baru dari ${newOrder.customer_name_snapshot}!`, {
          description: `${(newOrder.items || []).map((i) => `${i.menu_name} x${i.qty}`).join(", ")}`,
        });
        setOrders((prev) => {
          const updated = [newOrder, ...prev.filter((o) => o.id !== newOrder.id)];
          ordersRef.current = updated;
          return updated;
        });
        fetchStats();
      },
      (updatedOrder) => {
        setOrders((prev) => {
          const updated = prev.map((o) => (o.id === updatedOrder.id ? updatedOrder : o));
          ordersRef.current = updated;
          return updated;
        });
        setSelectedOrder((prev) =>
          prev && prev.id === updatedOrder.id ? updatedOrder : prev
        );
        fetchStats();
      }
    );
    return cleanup;
  }, [fetchStats]);

  const statCards = [
    {
      label: "Total Hari Ini",
      value: stats?.totalToday ?? 0,
      icon: ShoppingBag,
      color: "text-[var(--ngupi)]",
      bg: "bg-[var(--ngupi)]/10",
      ring: "ring-[var(--ngupi)]/20",
    },
    {
      label: "Menunggu",
      value: stats?.pendingDelivery ?? 0,
      icon: Clock,
      color: "text-amber-400",
      bg: "bg-amber-500/10",
      ring: "ring-amber-500/20",
    },
    {
      label: "Diantar",
      value: stats?.onTheWay ?? 0,
      icon: Truck,
      color: "text-purple-400",
      bg: "bg-purple-500/10",
      ring: "ring-purple-500/20",
    },
    {
      label: "Selesai",
      value: stats?.completedToday ?? 0,
      icon: CheckCircle2,
      color: "text-green-400",
      bg: "bg-green-500/10",
      ring: "ring-green-500/20",
    },
  ];

  return (
    <div className="space-y-5 sm:space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-foreground flex items-center gap-2">
            Dashboard
            <TrendingUp className="w-5 h-5 text-[var(--ngupi)] hidden sm:inline" />
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Ringkasan pesanan hari ini
          </p>
        </div>
        <Button
          variant="ghost"
          size="icon"
          onClick={() => {
            fetchStats();
            fetchOrders(activeFilter);
          }}
          title="Refresh"
          className="text-muted-foreground hover:text-[var(--ngupi)]"
        >
          <RefreshCw className="w-4.5 h-4.5" />
        </Button>
      </div>

      {/* Stats grid */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {statsLoading
          ? Array.from({ length: 4 }).map((_, i) => <StatSkeleton key={i} />)
          : statCards.map((stat) => {
              const Icon = stat.icon;
              return (
                <Card key={stat.label} className="border-border/50 hover:border-border transition-colors">
                  <CardContent className="p-4">
                    <div className="flex items-center gap-3">
                      <div className={`p-2.5 rounded-xl ${stat.bg} ring-1 ${stat.ring}`}>
                        <Icon className={`w-[18px] h-[18px] ${stat.color}`} />
                      </div>
                      <div>
                        <p className="text-2xl font-bold text-foreground tabular-nums">
                          {stat.value}
                        </p>
                        <p className="text-[11px] text-muted-foreground mt-0.5 leading-none">
                          {stat.label}
                        </p>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
      </div>

      {/* Filter tabs + order list */}
      <Tabs defaultValue="all" value={activeFilter} onValueChange={(v) => setActiveFilter(v as string)}>
        <div className="overflow-x-auto -mx-1 px-1 pb-1">
          <TabsList variant="line" className="w-full sm:w-auto">
            {filterTabs.map((tab) => (
              <TabsTrigger key={tab.key} value={tab.key} className="text-sm px-4">
                {tab.label}
              </TabsTrigger>
            ))}
          </TabsList>
        </div>

        {filterTabs.map((tab) => (
          <TabsContent key={tab.key} value={tab.key}>
            <div className="space-y-3 mt-3">
              {loading ? (
                Array.from({ length: 4 }).map((_, i) => <OrderSkeleton key={i} />)
              ) : orders.length === 0 ? (
                <div className="text-center py-16">
                  <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-secondary mb-4">
                    <Package className="w-7 h-7 text-muted-foreground" />
                  </div>
                  <p className="text-muted-foreground font-medium">Belum ada pesanan</p>
                  <p className="text-xs text-muted-foreground/60 mt-1">
                    Pesanan baru akan muncul secara realtime
                  </p>
                </div>
              ) : (
                orders.map((order) => (
                  <Card
                    key={order.id}
                    className="border-border/50 hover:border-[var(--ngupi-border-light)] transition-all cursor-pointer active:scale-[0.995]"
                    onClick={() => setSelectedOrder(order)}
                  >
                    <CardContent className="p-4">
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex-1 min-w-0">
                          {/* Name + ID */}
                          <div className="flex items-center gap-2 mb-1.5">
                            <h3 className="font-semibold text-foreground truncate">
                              {order.customer_name_snapshot}
                            </h3>
                            <span className="text-[11px] text-muted-foreground/60 font-mono shrink-0">
                              #{order.client_order_id?.slice(-4) || order.id}
                            </span>
                          </div>

                          {/* Phone + fulfillment */}
                          <div className="flex items-center gap-1.5 text-xs text-muted-foreground mb-2.5">
                            <a
                              href={formatWhatsAppLink(order.customer_phone_snapshot)}
                              target="_blank"
                              rel="noopener noreferrer"
                              onClick={(e) => e.stopPropagation()}
                              className="flex items-center gap-1 hover:text-green-400 transition-colors"
                            >
                              <Phone className="w-3 h-3" />
                              {order.customer_phone_snapshot}
                            </a>
                            <span className="text-border">·</span>
                            <span className="flex items-center gap-1">
                              {order.fulfillment_method === "delivery" ? (
                                <MapPin className="w-3 h-3" />
                              ) : (
                                <ShoppingBag className="w-3 h-3" />
                              )}
                              {order.fulfillment_method === "delivery" ? "Delivery" : "Pickup"}
                            </span>
                          </div>

                          {/* Items */}
                          <p className="text-sm text-muted-foreground mb-3 line-clamp-1">
                            {(order.items || []).map((item, i) => (
                              <span key={i}>
                                {i > 0 && ", "}
                                {item.menu_name} x{item.qty}
                                {item.temperature && (
                                  <span className="text-muted-foreground/50"> ({item.temperature})</span>
                                )}
                              </span>
                            ))}
                          </p>

                          {/* Badges */}
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <Badge className={getStatusColor(order.order_status)}>
                              {getStatusLabel(order.order_status)}
                            </Badge>
                            <Badge className={getPaymentStatusColor(order.payment_status)}>
                              {getPaymentStatusLabel(order.payment_status)}
                            </Badge>
                            <Badge variant="outline" className="text-muted-foreground border-border text-[11px]">
                              {(order.payment_method || "-").toUpperCase()}
                            </Badge>
                          </div>
                        </div>

                        {/* Price + time */}
                        <div className="text-right shrink-0">
                          <p className="font-semibold text-[var(--ngupi)] text-sm tabular-nums">
                            {order.payment?.total_payment
                              ? formatRupiah(order.payment.total_payment)
                              : order.payment?.amount
                              ? formatRupiah(order.payment.amount)
                              : "-"}
                          </p>
                          <p className="text-[11px] text-muted-foreground/60 mt-1 tabular-nums">
                            {formatTime(order.created_at)}
                          </p>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                ))
              )}
            </div>
          </TabsContent>
        ))}
      </Tabs>

      {/* Order detail modal */}
      {selectedOrder && (
        <OrderDetailModal
          order={selectedOrder}
          onClose={() => setSelectedOrder(null)}
          onStatusUpdate={(updatedOrder) => {
            setOrders((prev) =>
              prev.map((o) => (o.id === updatedOrder.id ? updatedOrder : o))
            );
            setSelectedOrder(updatedOrder);
            fetchStats();
            fetchOrders(activeFilter);
          }}
        />
      )}
    </div>
  );
}
