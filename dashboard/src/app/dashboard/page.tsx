"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
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
} from "@/lib/utils";
import {
  Package,
  Truck,
  CheckCircle2,
  Clock,
  Phone,
  MapPin,
  Coffee,
  RefreshCw,
  ShoppingBag,
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

export default function DashboardPage() {
  const [stats, setStats] = useState<OrderStats | null>(null);
  const [orders, setOrders] = useState<Order[]>([]);
  const [activeFilter, setActiveFilter] = useState("all");
  const [loading, setLoading] = useState(true);
  const [selectedOrder, setSelectedOrder] = useState<Order | null>(null);
  const ordersRef = useRef<Order[]>([]);

  const fetchStats = useCallback(async () => {
    try {
      const res = await getOrderStats();
      setStats(res.data);
    } catch {
      // silent
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
        // Also update selected order if it's the one being viewed
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
      value: stats?.totalToday ?? "-",
      icon: ShoppingBag,
      color: "text-[#3CC8C8]",
      bg: "bg-[#3CC8C8]/10",
    },
    {
      label: "Menunggu Dikirim",
      value: stats?.pendingDelivery ?? "-",
      icon: Clock,
      color: "text-blue-400",
      bg: "bg-blue-500/10",
    },
    {
      label: "Sedang Diantar",
      value: stats?.onTheWay ?? "-",
      icon: Truck,
      color: "text-purple-400",
      bg: "bg-purple-500/10",
    },
    {
      label: "Selesai",
      value: stats?.completedToday ?? "-",
      icon: CheckCircle2,
      color: "text-green-400",
      bg: "bg-green-500/10",
    },
  ];

  return (
    <div className="space-y-4 sm:space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-white">Dashboard</h1>
          <p className="text-sm text-white/50 mt-0.5">Ringkasan pesanan hari ini</p>
        </div>
        <button
          onClick={() => {
            fetchStats();
            fetchOrders(activeFilter);
          }}
          className="p-2 rounded-lg text-white/60 hover:text-[#3CC8C8] hover:bg-[#153030] transition-colors"
          title="Refresh"
        >
          <RefreshCw className="w-5 h-5" />
        </button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2 sm:gap-3">
        {statCards.map((stat) => {
          const Icon = stat.icon;
          return (
            <Card key={stat.label} className="border-[#1e4040]/50">
              <CardContent className="p-4">
                <div className="flex items-center gap-3">
                  <div className={`p-2.5 rounded-xl ${stat.bg}`}>
                    <Icon className={`w-5 h-5 ${stat.color}`} />
                  </div>
                  <div>
                    <p className="text-xl sm:text-2xl font-bold text-white">{stat.value}</p>
                    <p className="text-xs text-white/50 mt-0.5">{stat.label}</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* Filter tabs */}
      <div className="flex gap-1 overflow-x-auto pb-1 -mx-1 px-1">
        {filterTabs.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveFilter(tab.key)}
            className={`px-4 py-2.5 rounded-lg text-sm font-medium whitespace-nowrap transition-all ${
              activeFilter === tab.key
                ? "bg-[#1F8A8A]/20 text-[#3CC8C8] shadow-sm"
                : "text-white/60 hover:text-white/90 hover:bg-[#153030]/50"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Orders list */}
      <div className="space-y-3">
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <Coffee className="w-6 h-6 text-[#2BB5B5] animate-spin" />
          </div>
        ) : orders.length === 0 ? (
          <div className="text-center py-12">
            <Package className="w-12 h-12 text-white/30 mx-auto mb-3" />
            <p className="text-white/50">Belum ada pesanan</p>
          </div>
        ) : (
          orders.map((order) => (
            <Card
              key={order.id}
              className="border-[#1e4040]/50 hover:border-[#2a5555]/50 transition-all cursor-pointer active:scale-[0.99]"
              onClick={() => setSelectedOrder(order)}
            >
              <CardContent className="p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1.5">
                      <h3 className="font-semibold text-white truncate">
                        {order.customer_name_snapshot}
                      </h3>
                      <span className="text-xs text-white/40 shrink-0">
                        #{order.client_order_id?.slice(-4) || order.id}
                      </span>
                    </div>

                    <div className="flex items-center gap-1.5 text-xs text-white/50 mb-2">
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
                      {order.fulfillment_method === "delivery" && (
                        <span className="flex items-center gap-1 ml-2">
                          <MapPin className="w-3 h-3" />
                          Delivery
                        </span>
                      )}
                      {order.fulfillment_method === "pickup" && (
                        <span className="flex items-center gap-1 ml-2">
                          <ShoppingBag className="w-3 h-3" />
                          Pickup
                        </span>
                      )}
                    </div>

                    <div className="text-sm text-white/60 mb-2">
                      {(order.items || []).map((item, i) => (
                        <span key={i}>
                          {i > 0 && ", "}
                          {item.menu_name} x{item.qty}
                          {item.temperature && (
                            <span className="text-white/40"> ({item.temperature})</span>
                          )}
                        </span>
                      ))}
                    </div>

                    <div className="flex items-center gap-2 flex-wrap">
                      <Badge className={getStatusColor(order.order_status)}>
                        {getStatusLabel(order.order_status)}
                      </Badge>
                      <Badge className={getPaymentStatusColor(order.payment_status)}>
                        {getPaymentStatusLabel(order.payment_status)}
                      </Badge>
                      <Badge variant="outline" className="text-white/50 border-[#2a5555]">
                        {(order.payment_method || "-").toUpperCase()}
                      </Badge>
                    </div>
                  </div>

                  <div className="text-right shrink-0">
                    <p className="font-semibold text-[#3CC8C8] text-sm">
                      {order.payment?.total_payment
                        ? formatRupiah(order.payment.total_payment)
                        : order.payment?.amount
                        ? formatRupiah(order.payment.amount)
                        : "-"}
                    </p>
                    <p className="text-xs text-white/40 mt-1">
                      {formatTime(order.created_at)}
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))
        )}
      </div>

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
            // Re-fetch orders to ensure list is in sync
            fetchOrders(activeFilter);
          }}
        />
      )}
    </div>
  );
}
