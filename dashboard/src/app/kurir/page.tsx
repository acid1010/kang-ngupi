"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useAuth } from "@/lib/auth-context";
import {
  connectOrderStream,
  getOrders,
  getOrderStats,
  Order,
  OrderStats,
} from "@/lib/api";
import {
  formatRupiah,
  formatTime,
  formatWhatsAppLink,
  getFulfillmentLabel,
  getPaymentStatusColor,
  getPaymentStatusLabel,
  getStatusColor,
  getStatusLabel,
} from "@/lib/helpers";
import { OrderDetailModal } from "@/components/order-detail-modal";
import {
  CheckCircle2,
  Clock,
  LogOut,
  MapPin,
  Navigation,
  Package,
  Phone,
  RefreshCw,
  ShoppingBag,
  Truck,
} from "lucide-react";
import { toast } from "sonner";

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
      <Skeleton className="h-10 w-10 rounded-xl bg-secondary/50" />
      <Skeleton className="mt-4 h-8 w-12 bg-secondary/50" />
      <Skeleton className="mt-2 h-3 w-20 bg-secondary/50" />
    </div>
  );
}

function OrderSkeleton() {
  return (
    <div className="rounded-2xl border border-border/30 bg-card/40 p-4">
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

export default function CourierPage() {
  const { user, loading: authLoading, logout } = useAuth();
  const router = useRouter();
  const [stats, setStats] = useState<OrderStats | null>(null);
  const [orders, setOrders] = useState<Order[]>([]);
  const [activeFilter, setActiveFilter] = useState("all");
  const [loading, setLoading] = useState(true);
  const [statsLoading, setStatsLoading] = useState(true);
  const [selectedOrder, setSelectedOrder] = useState<Order | null>(null);
  const ordersRef = useRef<Order[]>([]);

  useEffect(() => {
    if (!authLoading && !user) {
      router.replace("/login");
    }
  }, [authLoading, router, user]);

  const fetchStats = useCallback(async () => {
    try {
      setStatsLoading(true);
      const res = await getOrderStats();
      setStats(res.data);
    } catch {
      toast.error("Failed to load courier stats");
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
      toast.error("Failed to load delivery orders");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!user) return;
    fetchStats();
    fetchOrders(activeFilter);
  }, [activeFilter, fetchOrders, fetchStats, user]);

  useEffect(() => {
    if (!user) return;
    const cleanup = connectOrderStream(
      (newOrder) => {
        if (newOrder.fulfillment_method !== "delivery") return;
        playNotificationSound();
        toast.success(`New delivery from ${newOrder.customer_name_snapshot}`, {
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
        if (updatedOrder.fulfillment_method !== "delivery") return;
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
  }, [fetchStats, user]);

  if (authLoading || !user) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="flex flex-col items-center gap-3">
          <div className="h-10 w-10 overflow-hidden rounded-xl ring-1 ring-border">
            <img src="/logo.jpg" alt="Go Ngupi" className="h-full w-full object-cover" />
          </div>
          <p className="text-xs text-muted-foreground">Loading courier operations</p>
        </div>
      </div>
    );
  }

  const statCards = [
    {
      label: "Delivery Today",
      value: stats?.totalToday ?? 0,
      icon: ShoppingBag,
      color: "text-[var(--ngupi)]",
      bg: "bg-[var(--ngupi)]/8",
      ring: "ring-[var(--ngupi)]/15",
    },
    {
      label: "Pending Pickup",
      value: stats?.pendingDelivery ?? 0,
      icon: Clock,
      color: "text-amber-400",
      bg: "bg-amber-500/8",
      ring: "ring-amber-500/15",
    },
    {
      label: "On The Way",
      value: stats?.onTheWay ?? 0,
      icon: Truck,
      color: "text-violet-400",
      bg: "bg-violet-500/8",
      ring: "ring-violet-500/15",
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

  return (
    <main className="min-h-screen w-full max-w-full overflow-x-hidden bg-background">
      <header className="sticky top-0 z-40 border-b border-border/40 bg-background/90 backdrop-blur-xl">
        <div className="mx-auto flex h-16 max-w-[1180px] items-center justify-between px-4 sm:px-6">
          <div className="flex items-center gap-3">
            <div className="h-9 w-9 overflow-hidden rounded-xl ring-1 ring-border/60">
              <img src="/logo.jpg" alt="Go Ngupi" className="h-full w-full object-cover" />
            </div>
            <div>
              <h1 className="text-sm font-bold tracking-tight text-[var(--ngupi)]">Go Ngupi Courier</h1>
              <p className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground/60">Delivery Operations</p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="icon"
              onClick={() => {
                fetchStats();
                fetchOrders(activeFilter);
              }}
              title="Refresh"
              className="rounded-xl text-muted-foreground/60 hover:bg-[var(--ngupi)]/5 hover:text-[var(--ngupi)]"
            >
              <RefreshCw className="h-4 w-4" />
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={logout}
              className="rounded-xl text-xs text-muted-foreground/70 hover:bg-red-500/[0.06] hover:text-red-400"
            >
              <LogOut className="mr-2 h-3.5 w-3.5" />
              Sign Out
            </Button>
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-[1180px] space-y-6 px-4 py-6 sm:px-6 sm:py-8">
        <section className="rounded-3xl border border-border/30 bg-card/35 p-5 sm:p-7">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <h2 className="max-w-4xl text-3xl font-bold tracking-[-0.04em] text-foreground sm:text-4xl">
                Courier Operations
              </h2>
              <p className="mt-2 max-w-xl text-sm font-light leading-6 text-muted-foreground">
                Delivery-only command center for incoming orders, pickup readiness, routes, and completion updates.
              </p>
            </div>
            <div className="inline-flex w-fit items-center gap-2 rounded-full border border-[var(--ngupi)]/20 bg-[var(--ngupi)]/8 px-3 py-1.5 text-xs font-medium text-[var(--ngupi)]">
              <Navigation className="h-3.5 w-3.5" />
              Live delivery feed
            </div>
          </div>
        </section>

        <section className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
          {statsLoading
            ? Array.from({ length: 4 }).map((_, i) => <StatSkeleton key={i} />)
            : statCards.map((stat) => {
                const Icon = stat.icon;
                return (
                  <div
                    key={stat.label}
                    className="group rounded-2xl border border-border/30 bg-card/50 p-5 transition-all duration-300 hover:border-border/60"
                  >
                    <div className={`mb-3 inline-flex rounded-xl p-2.5 ring-1 transition-transform duration-500 group-hover:scale-105 ${stat.bg} ${stat.ring}`}>
                      <Icon className={`h-[18px] w-[18px] ${stat.color}`} />
                    </div>
                    <p className="text-[28px] font-bold leading-none tracking-tight text-foreground tabular-nums">
                      {stat.value}
                    </p>
                    <p className="mt-1.5 text-[11px] font-medium uppercase tracking-wider text-muted-foreground/70">
                      {stat.label}
                    </p>
                  </div>
                );
              })}
        </section>

        <Tabs defaultValue="all" value={activeFilter} onValueChange={(v) => setActiveFilter(v)}>
          <div className="mb-4 flex items-center justify-between">
            <TabsList variant="line" className="w-auto">
              {filterTabs.map((tab) => (
                <TabsTrigger key={tab.key} value={tab.key} className="px-4 text-sm">
                  {tab.label}
                </TabsTrigger>
              ))}
            </TabsList>
          </div>

          {filterTabs.map((tab) => (
            <TabsContent key={tab.key} value={tab.key}>
              <div className="space-y-2.5">
                {loading ? (
                  Array.from({ length: 5 }).map((_, i) => <OrderSkeleton key={i} />)
                ) : orders.length === 0 ? (
                  <div className="py-20 text-center">
                    <div className="mb-4 inline-flex h-14 w-14 items-center justify-center rounded-2xl bg-secondary/30">
                      <Package className="h-6 w-6 text-muted-foreground/50" />
                    </div>
                    <p className="text-sm font-medium text-muted-foreground">No delivery orders</p>
                    <p className="mt-1 text-xs font-light text-muted-foreground/40">
                      New delivery orders will appear here in real time.
                    </p>
                  </div>
                ) : (
                  orders.map((order) => (
                    <div
                      key={order.id}
                      className="cursor-pointer rounded-2xl border border-border/30 bg-card/40 p-4 transition-all duration-300 hover:border-border/50 hover:bg-card/70 active:scale-[0.998]"
                      onClick={() => setSelectedOrder(order)}
                    >
                      <div className="flex items-start justify-between gap-4">
                        <div className="min-w-0 flex-1">
                          <div className="mb-1.5 flex items-center gap-2.5">
                            <h3 className="truncate text-[15px] font-semibold tracking-tight text-foreground">
                              {order.customer_name_snapshot}
                            </h3>
                            <span className="shrink-0 rounded bg-secondary/30 px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground/40">
                              #{order.client_order_id?.slice(-4) || order.id}
                            </span>
                          </div>

                          <div className="mb-3 flex items-center gap-2 text-xs text-muted-foreground/60">
                            <a
                              href={formatWhatsAppLink(order.customer_phone_snapshot)}
                              target="_blank"
                              rel="noopener noreferrer"
                              onClick={(e) => e.stopPropagation()}
                              className="flex items-center gap-1 transition-colors duration-200 hover:text-emerald-400"
                            >
                              <Phone className="h-3 w-3" />
                              {order.customer_phone_snapshot}
                            </a>
                            <span className="h-1 w-1 rounded-full bg-border" />
                            <span className="flex items-center gap-1">
                              <MapPin className="h-3 w-3" />
                              {getFulfillmentLabel(order.fulfillment_method)}
                            </span>
                          </div>

                          <p className="mb-3 line-clamp-1 text-[13px] font-light text-muted-foreground/70">
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

                          <div className="flex flex-wrap items-center gap-1.5">
                            <Badge className={getStatusColor(order.order_status)}>
                              {getStatusLabel(order.order_status)}
                            </Badge>
                            <Badge className={getPaymentStatusColor(order.payment_status)}>
                              {getPaymentStatusLabel(order.payment_status)}
                            </Badge>
                            <Badge variant="outline" className="border-border/40 font-mono text-[10px] text-muted-foreground/50">
                              {(order.payment_method || "-").toUpperCase()}
                            </Badge>
                          </div>
                        </div>

                        <div className="shrink-0 text-right">
                          <p className="text-sm font-semibold tracking-tight text-[var(--ngupi)] tabular-nums">
                            {order.payment?.total_payment
                              ? formatRupiah(order.payment.total_payment)
                              : order.payment?.amount
                              ? formatRupiah(order.payment.amount)
                              : "-"}
                          </p>
                          <p className="mt-1.5 font-mono text-[10px] text-muted-foreground/40 tabular-nums">
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
      </div>

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
    </main>
  );
}
