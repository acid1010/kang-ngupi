"use client";

import { useEffect, useState, useCallback } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";
import {
  getOrders,
  connectOrderStream,
  Order,
  OrdersMeta,
} from "@/lib/api";
import {
  formatRupiah,
  formatDateTime,
  getStatusLabel,
  getStatusColor,
  getPaymentStatusLabel,
  getPaymentStatusColor,
  formatWhatsAppLink,
} from "@/lib/helpers";
import {
  Package,
  Phone,
  MapPin,
  ChevronLeft,
  ChevronRight,
  ShoppingBag,
  Filter,
} from "lucide-react";
import { toast } from "sonner";
import { OrderDetailModal } from "@/components/order-detail-modal";

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

export default function OrdersPage() {
  const [orders, setOrders] = useState<Order[]>([]);
  const [meta, setMeta] = useState<OrdersMeta | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedOrder, setSelectedOrder] = useState<Order | null>(null);
  const [page, setPage] = useState(1);
  const [statusFilter, setStatusFilter] = useState("__all__");
  const [paymentFilter, setPaymentFilter] = useState("__all__");
  const [fulfillmentFilter, setFulfillmentFilter] = useState("__all__");
  const [showFilters, setShowFilters] = useState(false);

  const fetchOrders = useCallback(async () => {
    try {
      setLoading(true);
      const res = await getOrders({
        page,
        per_page: 25,
        status: statusFilter === "__all__" ? "" : statusFilter,
        payment_status: paymentFilter === "__all__" ? "" : paymentFilter,
        fulfillment: fulfillmentFilter === "__all__" ? "" : fulfillmentFilter,
        sort: "created_at",
        order: "desc",
      });
      setOrders(res.data);
      setMeta(res.meta);
    } catch {
      toast.error("Gagal memuat pesanan");
    } finally {
      setLoading(false);
    }
  }, [page, statusFilter, paymentFilter, fulfillmentFilter]);

  useEffect(() => {
    fetchOrders();
  }, [fetchOrders]);

  // SSE
  useEffect(() => {
    const cleanup = connectOrderStream(
      (newOrder) => {
        toast.success(`Pesanan baru dari ${newOrder.customer_name_snapshot}!`);
        if (page === 1 && statusFilter === "__all__" && paymentFilter === "__all__" && fulfillmentFilter === "__all__") {
          setOrders((prev) => [newOrder, ...prev.slice(0, 24)]);
        }
      },
      (updatedOrder) => {
        setOrders((prev) =>
          prev.map((o) => (o.id === updatedOrder.id ? updatedOrder : o))
        );
        setSelectedOrder((prev) =>
          prev && prev.id === updatedOrder.id ? updatedOrder : prev
        );
      }
    );
    return cleanup;
  }, [page, statusFilter, paymentFilter, fulfillmentFilter]);

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-foreground">Pesanan</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            {meta ? `${meta.total} pesanan total` : "Memuat..."}
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => setShowFilters(!showFilters)}
          className="lg:hidden"
        >
          <Filter className="w-4 h-4 mr-1" />
          Filter
        </Button>
      </div>

      {/* Filters */}
      <div
        className={`grid grid-cols-1 sm:grid-cols-3 gap-3 ${
          showFilters ? "grid" : "hidden lg:grid"
        }`}
      >
        <Select
          value={statusFilter}
          onValueChange={(v) => {
            setStatusFilter(v ?? "__all__");
            setPage(1);
          }}
        >
          <SelectTrigger className="w-full bg-secondary/50 border-border">
            <SelectValue placeholder="Semua Status" />
          </SelectTrigger>
          <SelectContent className="bg-card border-border">
            <SelectItem value="__all__">Semua Status</SelectItem>
            <SelectItem value="awaiting_payment">Menunggu Bayar</SelectItem>
            <SelectItem value="ready_to_submit">Siap Diproses</SelectItem>
            <SelectItem value="preparing">Sedang Dibuat</SelectItem>
            <SelectItem value="ready_for_pickup">Siap Diambil</SelectItem>
            <SelectItem value="picked_up">Sudah Diambil</SelectItem>
            <SelectItem value="on_the_way">Sedang Diantar</SelectItem>
            <SelectItem value="delivered">Terkirim</SelectItem>
            <SelectItem value="completed">Selesai</SelectItem>
            <SelectItem value="cancelled">Dibatalkan</SelectItem>
          </SelectContent>
        </Select>

        <Select
          value={paymentFilter}
          onValueChange={(v) => {
            setPaymentFilter(v ?? "__all__");
            setPage(1);
          }}
        >
          <SelectTrigger className="w-full bg-secondary/50 border-border">
            <SelectValue placeholder="Semua Pembayaran" />
          </SelectTrigger>
          <SelectContent className="bg-card border-border">
            <SelectItem value="__all__">Semua Pembayaran</SelectItem>
            <SelectItem value="pending">Belum Bayar</SelectItem>
            <SelectItem value="confirmed">Lunas</SelectItem>
          </SelectContent>
        </Select>

        <Select
          value={fulfillmentFilter}
          onValueChange={(v) => {
            setFulfillmentFilter(v ?? "__all__");
            setPage(1);
          }}
        >
          <SelectTrigger className="w-full bg-secondary/50 border-border">
            <SelectValue placeholder="Semua Metode" />
          </SelectTrigger>
          <SelectContent className="bg-card border-border">
            <SelectItem value="__all__">Semua Metode</SelectItem>
            <SelectItem value="delivery">Delivery</SelectItem>
            <SelectItem value="pickup">Pickup</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Orders */}
      <div className="space-y-3">
        {loading ? (
          Array.from({ length: 5 }).map((_, i) => <OrderSkeleton key={i} />)
        ) : orders.length === 0 ? (
          <div className="text-center py-16">
            <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-secondary mb-4">
              <Package className="w-7 h-7 text-muted-foreground" />
            </div>
            <p className="text-muted-foreground font-medium">Tidak ada pesanan ditemukan</p>
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
                    <div className="flex items-center gap-2 mb-1.5">
                      <h3 className="font-semibold text-foreground truncate">
                        {order.customer_name_snapshot}
                      </h3>
                      <span className="text-[11px] text-muted-foreground/60 font-mono shrink-0">
                        #{order.client_order_id?.slice(-4) || order.id}
                      </span>
                    </div>

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

                    <p className="text-sm text-muted-foreground mb-3 line-clamp-1">
                      {(order.items || [])
                        .map((item) => `${item.menu_name} x${item.qty}`)
                        .join(", ")}
                    </p>

                    <div className="flex items-center gap-1.5 flex-wrap">
                      <Badge className={getStatusColor(order.order_status)}>
                        {getStatusLabel(order.order_status)}
                      </Badge>
                      <Badge className={getPaymentStatusColor(order.payment_status)}>
                        {getPaymentStatusLabel(order.payment_status)}
                      </Badge>
                    </div>
                  </div>

                  <div className="text-right shrink-0">
                    <p className="font-semibold text-[var(--ngupi)] text-sm tabular-nums">
                      {order.payment?.total_payment
                        ? formatRupiah(order.payment.total_payment)
                        : order.payment?.amount
                        ? formatRupiah(order.payment.amount)
                        : "-"}
                    </p>
                    <p className="text-[11px] text-muted-foreground/60 mt-1">
                      {formatDateTime(order.created_at)}
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))
        )}
      </div>

      {/* Pagination */}
      {meta && meta.pages > 1 && (
        <div className="flex items-center justify-between pt-2">
          <p className="text-sm text-muted-foreground">
            Halaman {meta.page} dari {meta.pages}
          </p>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page <= 1}
            >
              <ChevronLeft className="w-4 h-4" />
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setPage((p) => Math.min(meta.pages, p + 1))}
              disabled={page >= meta.pages}
            >
              <ChevronRight className="w-4 h-4" />
            </Button>
          </div>
        </div>
      )}

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
          }}
        />
      )}
    </div>
  );
}
