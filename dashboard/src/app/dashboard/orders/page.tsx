"use client";

import { useEffect, useState, useCallback } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import {
  getOrders,
  connectOrderStream,
  Order,
  OrdersMeta,
} from "@/lib/api";
import {
  formatRupiah,
  formatTime,
  formatDateTime,
  getStatusLabel,
  getStatusColor,
  getPaymentStatusLabel,
  getPaymentStatusColor,
  formatWhatsAppLink,
} from "@/lib/utils";
import {
  Package,
  Phone,
  MapPin,
  Coffee,
  ChevronLeft,
  ChevronRight,
  ShoppingBag,
  Filter,
} from "lucide-react";
import { toast } from "sonner";
import { OrderDetailModal } from "@/components/order-detail-modal";

export default function OrdersPage() {
  const [orders, setOrders] = useState<Order[]>([]);
  const [meta, setMeta] = useState<OrdersMeta | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedOrder, setSelectedOrder] = useState<Order | null>(null);
  const [page, setPage] = useState(1);
  const [statusFilter, setStatusFilter] = useState("");
  const [paymentFilter, setPaymentFilter] = useState("");
  const [fulfillmentFilter, setFulfillmentFilter] = useState("");
  const [showFilters, setShowFilters] = useState(false);

  const fetchOrders = useCallback(async () => {
    try {
      setLoading(true);
      const res = await getOrders({
        page,
        per_page: 25,
        status: statusFilter,
        payment_status: paymentFilter,
        fulfillment: fulfillmentFilter,
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
        if (page === 1 && !statusFilter && !paymentFilter && !fulfillmentFilter) {
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
          <h1 className="text-2xl font-bold text-white">Pesanan</h1>
          <p className="text-sm text-white/50 mt-0.5">
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
          showFilters ? "block" : "hidden lg:grid"
        }`}
      >
        <Select
          value={statusFilter}
          onChange={(e) => {
            setStatusFilter(e.target.value);
            setPage(1);
          }}
        >
          <option value="">Semua Status</option>
          <option value="awaiting_payment">Menunggu Bayar</option>
          <option value="ready_to_submit">Siap Diproses</option>
          <option value="preparing">Sedang Dibuat</option>
          <option value="ready_for_pickup">Siap Diambil</option>
          <option value="picked_up">Sudah Diambil</option>
          <option value="on_the_way">Sedang Diantar</option>
          <option value="delivered">Terkirim</option>
          <option value="completed">Selesai</option>
          <option value="cancelled">Dibatalkan</option>
        </Select>
        <Select
          value={paymentFilter}
          onChange={(e) => {
            setPaymentFilter(e.target.value);
            setPage(1);
          }}
        >
          <option value="">Semua Pembayaran</option>
          <option value="pending">Belum Bayar</option>
          <option value="confirmed">Lunas</option>
        </Select>
        <Select
          value={fulfillmentFilter}
          onChange={(e) => {
            setFulfillmentFilter(e.target.value);
            setPage(1);
          }}
        >
          <option value="">Semua Metode</option>
          <option value="delivery">Delivery</option>
          <option value="pickup">Pickup</option>
        </Select>
      </div>

      {/* Orders */}
      <div className="space-y-3">
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <Coffee className="w-6 h-6 text-[#2BB5B5] animate-spin" />
          </div>
        ) : orders.length === 0 ? (
          <div className="text-center py-12">
            <Package className="w-12 h-12 text-white/30 mx-auto mb-3" />
            <p className="text-white/50">Tidak ada pesanan ditemukan</p>
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
                    <div className="flex items-center gap-2 mb-1">
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
                      <span className="flex items-center gap-1 ml-2">
                        {order.fulfillment_method === "delivery" ? (
                          <MapPin className="w-3 h-3" />
                        ) : (
                          <ShoppingBag className="w-3 h-3" />
                        )}
                        {order.fulfillment_method === "delivery" ? "Delivery" : "Pickup"}
                      </span>
                    </div>

                    <p className="text-sm text-white/60 mb-2 line-clamp-1">
                      {order.items
                        .map((item) => `${item.menu_name} x${item.qty}`)
                        .join(", ")}
                    </p>

                    <div className="flex items-center gap-2 flex-wrap">
                      <Badge className={getStatusColor(order.order_status)}>
                        {getStatusLabel(order.order_status)}
                      </Badge>
                      <Badge className={getPaymentStatusColor(order.payment_status)}>
                        {getPaymentStatusLabel(order.payment_status)}
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
          <p className="text-sm text-white/50">
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
