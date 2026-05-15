"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  getOrders,
  getOrderStats,
  getMenuStats,
  connectOrderStream,
  Order,
  OrderStats,
  MenuStats,
} from "@/lib/api";
import {
  formatRupiah,
  formatTime,
  getStatusLabel,
  getStatusColor,
  getPaymentStatusLabel,
  getPaymentStatusColor,
  formatWhatsAppLink,
  getFulfillmentLabel,
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
  UtensilsCrossed,
  DollarSign,
  TrendingUp,
  Coffee,
  AlertTriangle,
  Sparkles,
  Layers3,
} from "lucide-react";
import { toast } from "sonner";
import { OrderDetailModal } from "@/components/order-detail-modal";

const filterTabs = [
  { key: "all", label: "Active" },
  { key: "done", label: "Completed" },
];

const statusMap: Record<string, string> = {
  all: "awaiting_payment,ready_to_submit,preparing,on_the_way,ready_for_pickup",
  done: "completed",
};

function playNotificationSound() {
  try {
    const audio = new Audio("/sounds/new-order.wav");
    audio.volume = 0.5;
    audio.play().catch(() => {});
  } catch {}
}

function StatSkeleton() {
  return (
    <div className="rounded-2xl border border-border/30 bg-card/50 p-5">
      <div className="space-y-3">
        <Skeleton className="w-10 h-10 rounded-xl bg-secondary/50" />
        <Skeleton className="h-8 w-12 bg-secondary/50" />
        <Skeleton className="h-3 w-20 bg-secondary/50" />
      </div>
    </div>
  );
}

function OrderSkeleton() {
  return (
    <div className="rounded-xl border border-border/30 bg-card/40 p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 space-y-3">
          <Skeleton className="h-5 w-32 bg-secondary/50" />
          <Skeleton className="h-3.5 w-44 bg-secondary/50" />
          <Skeleton className="h-4 w-56 bg-secondary/50" />
          <div className="flex gap-2">
            <Skeleton className="h-5 w-20 rounded-full bg-secondary/50" />
            <Skeleton className="h-5 w-16 rounded-full bg-secondary/50" />
          </div>
        </div>
        <Skeleton className="h-5 w-20 bg-secondary/50" />
      </div>
    </div>
  );
}

export default function DashboardPage() {
  const [stats, setStats] = useState<OrderStats | null>(null);
  const [menuStats, setMenuStats] = useState<MenuStats | null>(null);
  const [orders, setOrders] = useState<Order[]>([]);
  const [activeFilter, setActiveFilter] = useState("all");
  const [loading, setLoading] = useState(true);
  const [statsLoading, setStatsLoading] = useState(true);
  const [selectedOrder, setSelectedOrder] = useState<Order | null>(null);
  const ordersRef = useRef<Order[]>([]);

  const fetchStats = useCallback(async () => {
    try {
      setStatsLoading(true);
      const [orderRes, menuRes] = await Promise.all([getOrderStats(), getMenuStats()]);
      setStats(orderRes.data);
      setMenuStats(menuRes.data);
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
        fulfillment: "delivery",
      };
      if (statusMap[filter]) {
        params.status = statusMap[filter];
      }
      const res = await getOrders(params);
      setOrders(res.data);
      ordersRef.current = res.data;
    } catch {
      toast.error("Failed to load orders");
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
        playNotificationSound();
        toast.success(`New order from ${newOrder.customer_name_snapshot}`, {
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
      label: "Revenue",
      value: stats?.revenueToday ? formatRupiah(stats.revenueToday) : "Rp0",
      icon: DollarSign,
      color: "text-[var(--ngupi)]",
      bg: "bg-[var(--ngupi)]/8",
      ring: "ring-[var(--ngupi)]/15",
      isText: true,
    },
    {
      label: "Orders Today",
      value: stats?.totalToday ?? 0,
      icon: ShoppingBag,
      color: "text-blue-400",
      bg: "bg-blue-500/8",
      ring: "ring-blue-500/15",
    },
    {
      label: "Avg Order",
      value: stats?.avgOrderValue ? formatRupiah(stats.avgOrderValue) : "Rp0",
      icon: TrendingUp,
      color: "text-cyan-400",
      bg: "bg-cyan-500/8",
      ring: "ring-cyan-500/15",
      isText: true,
    },
    {
      label: "Completed",
      value: stats?.completedToday ?? 0,
      icon: CheckCircle2,
      color: "text-emerald-400",
      bg: "bg-emerald-500/8",
      ring: "ring-emerald-500/15",
    },
  ];

  const fulfillmentCards = [
    {
      label: "Delivery",
      value: stats?.deliveryToday ?? 0,
      icon: Truck,
      color: "text-violet-400",
      bg: "bg-violet-500/8",
      ring: "ring-violet-500/15",
    },
    {
      label: "Dine-in",
      value: stats?.dineInToday ?? 0,
      icon: Coffee,
      color: "text-amber-400",
      bg: "bg-amber-500/8",
      ring: "ring-amber-500/15",
    },
    {
      label: "Pickup",
      value: stats?.pickupToday ?? 0,
      icon: Package,
      color: "text-rose-400",
      bg: "bg-rose-500/8",
      ring: "ring-rose-500/15",
    },
    {
      label: "Pending",
      value: stats?.pendingDelivery ?? 0,
      icon: Clock,
      color: "text-orange-400",
      bg: "bg-orange-500/8",
      ring: "ring-orange-500/15",
    },
  ];

  const availabilityTone =
    (menuStats?.availabilityRate ?? 0) >= 85
      ? "text-emerald-400"
      : (menuStats?.availabilityRate ?? 0) >= 70
      ? "text-amber-400"
      : "text-rose-400";

  return (
    <div className="space-y-6 sm:space-y-8">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl sm:text-[28px] font-bold text-foreground tracking-tight">
            Dashboard
          </h1>
          <p className="text-sm text-muted-foreground mt-1 font-light">
            Today&apos;s order summary
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
          className="text-muted-foreground/60 hover:text-[var(--ngupi)] hover:bg-[var(--ngupi)]/5 rounded-xl transition-all duration-300"
        >
          <RefreshCw className="w-4 h-4" />
        </Button>
      </div>

      {/* Stats grid — Revenue row */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        {statsLoading
          ? Array.from({ length: 4 }).map((_, i) => <StatSkeleton key={i} />)
          : statCards.map((stat) => {
              const Icon = stat.icon;
              return (
                <div
                  key={stat.label}
                  className="rounded-2xl border border-border/30 bg-card/50 p-5 hover:border-border/60 transition-all duration-300 group"
                >
                  <div className={`inline-flex p-2.5 rounded-xl ${stat.bg} ring-1 ${stat.ring} mb-3 transition-transform duration-500 group-hover:scale-105`}>
                    <Icon className={`w-[18px] h-[18px] ${stat.color}`} />
                  </div>
                  <p className={`font-bold text-foreground tabular-nums tracking-tight leading-none ${(stat as any).isText ? 'text-[20px] sm:text-[24px]' : 'text-[28px]'}`}>
                    {stat.value}
                  </p>
                  <p className="text-[11px] text-muted-foreground/70 mt-1.5 font-medium uppercase tracking-wider">
                    {stat.label}
                  </p>
                </div>
              );
            })}
      </div>

      {/* Stats grid — Fulfillment breakdown */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        {statsLoading
          ? Array.from({ length: 4 }).map((_, i) => <StatSkeleton key={i} />)
          : fulfillmentCards.map((stat) => {
              const Icon = stat.icon;
              return (
                <div
                  key={stat.label}
                  className="rounded-2xl border border-border/30 bg-card/50 p-4 hover:border-border/60 transition-all duration-300 group"
                >
                  <div className="flex items-center gap-3">
                    <div className={`inline-flex p-2 rounded-lg ${stat.bg} ring-1 ${stat.ring} transition-transform duration-500 group-hover:scale-105`}>
                      <Icon className={`w-4 h-4 ${stat.color}`} />
                    </div>
                    <div>
                      <p className="text-[22px] font-bold text-foreground tabular-nums tracking-tight leading-none">
                        {stat.value}
                      </p>
                      <p className="text-[10px] text-muted-foreground/70 mt-0.5 font-medium uppercase tracking-wider">
                        {stat.label}
                      </p>
                    </div>
                  </div>
                </div>
              );
            })}
      </div>

      {/* Menu availability */}
      <div className="grid gap-4 lg:grid-cols-[1.15fr_0.85fr]">
        <Card className="border-border/30 bg-card/50 overflow-hidden">
          <CardContent className="p-0">
            <div className="p-5 sm:p-6 border-b border-border/20 bg-gradient-to-br from-[var(--ngupi)]/10 via-transparent to-transparent">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <div className="inline-flex items-center gap-2 rounded-full border border-[var(--ngupi)]/20 bg-[var(--ngupi)]/8 px-2.5 py-1 text-[11px] font-medium uppercase tracking-[0.18em] text-[var(--ngupi)]/90">
                    <Layers3 className="h-3.5 w-3.5" />
                    Menu Availability
                  </div>
                  <h2 className="mt-3 text-lg font-semibold tracking-tight text-foreground">
                    Pantau item kosong tanpa buka menu schema
                  </h2>
                  <p className="mt-1 text-sm text-muted-foreground/70">
                    Snapshot stok terakhir buat operasional hari ini.
                  </p>
                </div>
                <div className="rounded-2xl border border-border/30 bg-background/40 px-4 py-3 text-right backdrop-blur-sm">
                  <p className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground/60">Unavailable</p>
                  <p className="mt-1 text-3xl font-bold tracking-tight text-foreground tabular-nums">
                    {statsLoading ? "--" : menuStats?.unavailableItems ?? 0}
                  </p>
                </div>
              </div>
            </div>

            <div className="grid gap-4 p-5 sm:grid-cols-3 sm:p-6">
              <div className="rounded-2xl border border-border/25 bg-background/30 p-4">
                <p className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground/60">Availability Rate</p>
                <p className={`mt-2 text-2xl font-bold tracking-tight ${availabilityTone}`}>
                  {statsLoading ? "--" : `${menuStats?.availabilityRate ?? 0}%`}
                </p>
                <div className="mt-3 h-2 overflow-hidden rounded-full bg-secondary/45">
                  <div
                    className="h-full rounded-full bg-[var(--ngupi)] transition-all duration-500"
                    style={{ width: `${menuStats?.availabilityRate ?? 0}%` }}
                  />
                </div>
              </div>

              <div className="rounded-2xl border border-border/25 bg-background/30 p-4">
                <p className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground/60">Available Now</p>
                <p className="mt-2 text-2xl font-bold tracking-tight text-foreground tabular-nums">
                  {statsLoading ? "--" : menuStats?.availableItems ?? 0}
                </p>
                <p className="mt-1 text-xs text-muted-foreground/60">
                  dari {statsLoading ? "--" : menuStats?.totalItems ?? 0} item menu
                </p>
              </div>

              <div className="rounded-2xl border border-border/25 bg-background/30 p-4">
                <p className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground/60">Last Sync</p>
                <p className="mt-2 text-sm font-semibold tracking-tight text-foreground">
                  {statsLoading
                    ? "Checking..."
                    : menuStats?.lastSyncedAt
                    ? formatTime(menuStats.lastSyncedAt)
                    : "Belum ada sync"}
                </p>
                <p className="mt-1 text-xs text-muted-foreground/60">
                  update stok dari snapshot menu terbaru
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="border-border/30 bg-card/50">
          <CardContent className="p-5 sm:p-6">
            <div className="flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-amber-400" />
              <h3 className="text-sm font-semibold uppercase tracking-[0.18em] text-muted-foreground/75">
                Hot Categories
              </h3>
            </div>

            <div className="mt-4 space-y-3">
              {statsLoading ? (
                Array.from({ length: 4 }).map((_, i) => (
                  <div key={i} className="rounded-xl border border-border/20 bg-background/25 p-3">
                    <Skeleton className="h-4 w-28 bg-secondary/50" />
                    <Skeleton className="mt-2 h-2 w-full bg-secondary/50" />
                  </div>
                ))
              ) : menuStats?.topUnavailableCategories?.length ? (
                menuStats.topUnavailableCategories.map((entry, index) => (
                  <div key={entry.category} className="rounded-xl border border-border/20 bg-background/25 p-3">
                    <div className="mb-2 flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium text-foreground">{entry.category}</p>
                        <p className="text-[11px] text-muted-foreground/60">kategori paling banyak kosong #{index + 1}</p>
                      </div>
                      <Badge variant="outline" className="border-amber-500/20 bg-amber-500/10 text-amber-300">
                        {entry.count} item
                      </Badge>
                    </div>
                    <div className="h-1.5 overflow-hidden rounded-full bg-secondary/45">
                      <div
                        className="h-full rounded-full bg-gradient-to-r from-amber-400 to-rose-400"
                        style={{ width: `${Math.min(100, entry.count * 12)}%` }}
                      />
                    </div>
                  </div>
                ))
              ) : (
                <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-4 text-sm text-emerald-300">
                  Semua kategori aman. Nggak ada item kosong sekarang ✨
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      <Card className="border-border/30 bg-card/50">
        <CardContent className="p-5 sm:p-6">
          <div className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-[var(--ngupi)]" />
            <h3 className="text-sm font-semibold uppercase tracking-[0.18em] text-muted-foreground/75">
              Recently Unavailable
            </h3>
          </div>

          <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {statsLoading ? (
              Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="rounded-xl border border-border/20 bg-background/25 p-4">
                  <Skeleton className="h-4 w-36 bg-secondary/50" />
                  <Skeleton className="mt-2 h-3 w-24 bg-secondary/50" />
                </div>
              ))
            ) : menuStats?.latestUnavailable?.length ? (
              menuStats.latestUnavailable.map((item) => (
                <div key={item.id} className="rounded-xl border border-border/20 bg-background/25 p-4 transition-colors duration-300 hover:border-border/40">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="line-clamp-2 text-sm font-medium leading-snug text-foreground">
                        {item.name}
                      </p>
                      <p className="mt-1 text-xs text-muted-foreground/60">{item.category}</p>
                    </div>
                    <Badge variant="outline" className="border-rose-500/20 bg-rose-500/10 text-rose-300">
                      Off
                    </Badge>
                  </div>
                  <p className="mt-3 text-xs font-medium text-muted-foreground/70">
                    {formatRupiah(item.price)}
                  </p>
                </div>
              ))
            ) : (
              <div className="md:col-span-2 xl:col-span-3 rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-4 text-sm text-emerald-300">
                Belum ada item unavailable. Stok lagi bagus semua.
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Filter tabs + order list */}
      <Tabs defaultValue="all" value={activeFilter} onValueChange={(v) => setActiveFilter(v as string)}>
        <div className="flex items-center justify-between mb-4">
          <TabsList variant="line" className="w-auto">
            {filterTabs.map((tab) => (
              <TabsTrigger key={tab.key} value={tab.key} className="text-sm px-4">
                {tab.label}
              </TabsTrigger>
            ))}
          </TabsList>
        </div>

        {filterTabs.map((tab) => (
          <TabsContent key={tab.key} value={tab.key}>
            <div className="space-y-2.5">
              {loading ? (
                Array.from({ length: 4 }).map((_, i) => <OrderSkeleton key={i} />)
              ) : orders.length === 0 ? (
                <div className="text-center py-20">
                  <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-secondary/30 mb-4">
                    <Package className="w-6 h-6 text-muted-foreground/50" />
                  </div>
                  <p className="text-muted-foreground font-medium text-sm">No orders yet</p>
                  <p className="text-xs text-muted-foreground/40 mt-1 font-light">
                    New orders will appear in real-time
                  </p>
                </div>
              ) : (
                orders.map((order) => (
                  <div
                    key={order.id}
                    className="rounded-xl border border-border/30 bg-card/40 hover:bg-card/70 hover:border-border/50 transition-all duration-300 cursor-pointer active:scale-[0.998] p-4"
                    onClick={() => setSelectedOrder(order)}
                  >
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex-1 min-w-0">
                        {/* Name + ID */}
                        <div className="flex items-center gap-2.5 mb-1.5">
                          <h3 className="font-semibold text-foreground text-[15px] truncate tracking-tight">
                            {order.customer_name_snapshot}
                          </h3>
                          <span className="text-[10px] text-muted-foreground/40 font-mono shrink-0 bg-secondary/30 px-1.5 py-0.5 rounded">
                            #{order.client_order_id?.slice(-4) || order.id}
                          </span>
                        </div>

                        {/* Phone + fulfillment */}
                        <div className="flex items-center gap-2 text-xs text-muted-foreground/60 mb-3">
                          <a
                            href={formatWhatsAppLink(order.customer_phone_snapshot)}
                            target="_blank"
                            rel="noopener noreferrer"
                            onClick={(e) => e.stopPropagation()}
                            className="flex items-center gap-1 hover:text-emerald-400 transition-colors duration-200"
                          >
                            <Phone className="w-3 h-3" />
                            {order.customer_phone_snapshot}
                          </a>
                          <span className="w-1 h-1 rounded-full bg-border" />
                          <span className="flex items-center gap-1">
                            {order.fulfillment_method === "delivery" ? (
                              <MapPin className="w-3 h-3" />
                            ) : order.fulfillment_method === "dine_in" ? (
                              <UtensilsCrossed className="w-3 h-3" />
                            ) : (
                              <ShoppingBag className="w-3 h-3" />
                            )}
                            {order.fulfillment_method === "dine_in" && order.table_number
                              ? `Table ${order.table_number}`
                              : getFulfillmentLabel(order.fulfillment_method)}
                          </span>
                        </div>

                        {/* Items */}
                        <p className="text-[13px] text-muted-foreground/70 mb-3 line-clamp-1 font-light">
                          {(order.items || []).map((item, i) => (
                            <span key={i}>
                              {i > 0 && ", "}
                              {item.menu_name} x{item.qty}
                              {item.temperature && (
                                <span className="text-muted-foreground/40"> ({item.temperature})</span>
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
                          <Badge variant="outline" className="text-muted-foreground/50 border-border/40 text-[10px] font-mono">
                            {(order.payment_method || "-").toUpperCase()}
                          </Badge>
                        </div>
                      </div>

                      {/* Price + time */}
                      <div className="text-right shrink-0">
                        <p className="font-semibold text-[var(--ngupi)] text-sm tabular-nums tracking-tight">
                          {order.payment?.total_payment
                            ? formatRupiah(order.payment.total_payment)
                            : order.payment?.amount
                            ? formatRupiah(order.payment.amount)
                            : "-"}
                        </p>
                        <p className="text-[10px] text-muted-foreground/40 mt-1.5 tabular-nums font-mono">
                          {formatTime(order.created_at)}
                        </p>
                      </div>
                    </div>
                  </div>
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
