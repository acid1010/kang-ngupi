"use client";

import { useEffect, useState, use } from "react";
import { useRouter } from "next/navigation";
import { getOrder, updateOrderStatus, Order } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  formatRupiah,
  formatDateTime,
  formatWhatsAppLink,
  formatGoogleMapsLink,
  getStatusLabel,
  getStatusColor,
  getPaymentStatusLabel,
  getPaymentStatusColor,
} from "@/lib/utils";
import {
  ArrowLeft,
  Phone,
  MapPin,
  ExternalLink,
  Loader2,
  ChevronRight,
  CreditCard,
  ShoppingBag,
  Truck,
  CheckCircle2,
  Clock,
  XCircle,
  Coffee,
  PackageCheck,
  Navigation,
} from "lucide-react";
import { toast } from "sonner";

const STATUS_FLOW = [
  "awaiting_payment",
  "ready_to_submit",
  "preparing",
  "ready_for_pickup",
  "picked_up",
  "on_the_way",
  "delivered",
  "completed",
];

const STATUS_ICONS: Record<string, React.ElementType> = {
  awaiting_payment: CreditCard,
  ready_to_submit: Clock,
  preparing: Coffee,
  ready_for_pickup: PackageCheck,
  picked_up: ShoppingBag,
  on_the_way: Navigation,
  delivered: Truck,
  completed: CheckCircle2,
  cancelled: XCircle,
};

function getNextStatuses(current: string): string[] {
  if (current === "cancelled" || current === "completed") return [];
  const idx = STATUS_FLOW.indexOf(current);
  if (idx === -1) return [];
  const next = STATUS_FLOW.slice(idx + 1, idx + 3);
  return [...next, "cancelled"];
}

export default function OrderDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const router = useRouter();
  const [order, setOrder] = useState<Order | null>(null);
  const [loading, setLoading] = useState(true);
  const [updating, setUpdating] = useState<string | null>(null);

  useEffect(() => {
    async function fetchOrder() {
      try {
        const res = await getOrder(Number(id));
        setOrder(res.data);
      } catch {
        toast.error("Gagal memuat pesanan");
        router.push("/dashboard/orders");
      } finally {
        setLoading(false);
      }
    }
    fetchOrder();
  }, [id, router]);

  async function handleStatusUpdate(newStatus: string) {
    if (!order) return;
    setUpdating(newStatus);
    try {
      const updated = await updateOrderStatus(order.id, newStatus);
      toast.success(`Status diubah ke ${getStatusLabel(newStatus)}`);
      setOrder(updated);
    } catch {
      toast.error("Gagal mengubah status");
    } finally {
      setUpdating(null);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Coffee className="w-8 h-8 text-[#2BB5B5] animate-spin" />
      </div>
    );
  }

  if (!order) return null;

  const nextStatuses = getNextStatuses(order.order_status);
  const currentIdx = STATUS_FLOW.indexOf(order.order_status);

  return (
    <div className="space-y-6 max-w-2xl mx-auto">
      {/* Back button */}
      <button
        onClick={() => router.back()}
        className="flex items-center gap-2 text-sm text-white/60 hover:text-white/90 transition-colors"
      >
        <ArrowLeft className="w-4 h-4" />
        Kembali
      </button>

      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">
            Pesanan #{order.client_order_id || order.id}
          </h1>
          <p className="text-sm text-white/50 mt-0.5">
            {formatDateTime(order.created_at)}
          </p>
        </div>
        <Badge className={`${getStatusColor(order.order_status)} text-sm px-3 py-1`}>
          {getStatusLabel(order.order_status)}
        </Badge>
      </div>

      {/* Customer */}
      <Card>
        <CardContent className="p-4 space-y-3">
          <h3 className="text-xs font-medium text-white/50 uppercase tracking-wider">
            Customer
          </h3>
          <div className="flex items-center justify-between">
            <div>
              <p className="font-semibold text-white text-lg">
                {order.customer_name_snapshot}
              </p>
              <a
                href={formatWhatsAppLink(order.customer_phone_snapshot)}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1.5 text-sm text-green-400 hover:text-green-300 transition-colors mt-1"
              >
                <Phone className="w-3.5 h-3.5" />
                {order.customer_phone_snapshot}
                <ExternalLink className="w-3 h-3" />
              </a>
            </div>
            <Badge variant="outline" className="capitalize">
              {order.fulfillment_method}
            </Badge>
          </div>

          {order.fulfillment_method === "delivery" &&
            order.location_lat &&
            order.location_lng && (
              <a
                href={formatGoogleMapsLink(order.location_lat, order.location_lng)}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-3 p-3 rounded-xl bg-blue-500/10 border border-blue-500/20 hover:bg-blue-500/15 transition-colors"
              >
                <MapPin className="w-5 h-5 text-blue-400 shrink-0" />
                <div className="flex-1">
                  <p className="text-sm font-medium text-blue-300">Lokasi Pengiriman</p>
                  <p className="text-xs text-blue-400/70">
                    {order.location_lat.toFixed(6)}, {order.location_lng.toFixed(6)}
                  </p>
                </div>
                <ExternalLink className="w-4 h-4 text-blue-400" />
              </a>
            )}
        </CardContent>
      </Card>

      {/* Items */}
      <Card>
        <CardContent className="p-4 space-y-3">
          <h3 className="text-xs font-medium text-white/50 uppercase tracking-wider">
            Pesanan
          </h3>
          <div className="space-y-2">
            {order.items.map((item, i) => (
              <div
                key={i}
                className="flex items-center justify-between py-2 border-b border-[#1e4040]/50 last:border-0"
              >
                <div>
                  <p className="text-sm font-medium text-white/90">{item.menu_name}</p>
                  {item.temperature && (
                    <p className="text-xs text-white/50">{item.temperature}</p>
                  )}
                </div>
                <span className="text-sm text-white/60 font-medium">x{item.qty}</span>
              </div>
            ))}
          </div>
          <div className="flex items-center justify-between pt-2 border-t border-[#2a5555]">
            <div className="flex items-center gap-2">
              <Badge className={getPaymentStatusColor(order.payment_status)}>
                {getPaymentStatusLabel(order.payment_status)}
              </Badge>
              <Badge variant="outline" className="text-white/60 border-[#2a5555]">
                {order.payment_method.toUpperCase()}
              </Badge>
            </div>
            <p className="font-bold text-[#3CC8C8] text-xl">
              {order.payment?.total_payment
                ? formatRupiah(order.payment.total_payment)
                : order.payment?.amount
                ? formatRupiah(order.payment.amount)
                : "-"}
            </p>
          </div>
          {order.payment?.paid_at && (
            <p className="text-xs text-white/50">
              Dibayar: {formatDateTime(order.payment.paid_at)}
            </p>
          )}
        </CardContent>
      </Card>

      {/* Status timeline */}
      <Card>
        <CardContent className="p-4 space-y-3">
          <h3 className="text-xs font-medium text-white/50 uppercase tracking-wider">
            Progress
          </h3>
          <div className="space-y-0">
            {STATUS_FLOW.map((status, idx) => {
              const Icon = STATUS_ICONS[status] || Clock;
              const isCurrent = status === order.order_status;
              const isPast = idx < currentIdx;
              const isCancelled = order.order_status === "cancelled";

              return (
                <div key={status} className="flex items-center gap-3 relative">
                  {idx < STATUS_FLOW.length - 1 && (
                    <div
                      className={`absolute left-[15px] top-[30px] w-0.5 h-[calc(100%-6px)] ${
                        isPast && !isCancelled ? "bg-[#1F8A8A]" : "bg-[#153030]"
                      }`}
                    />
                  )}
                  <div
                    className={`relative z-10 w-[30px] h-[30px] rounded-full flex items-center justify-center shrink-0 ${
                      isCurrent
                        ? "bg-[#1F8A8A] ring-2 ring-[#2BB5B5]/30"
                        : isPast && !isCancelled
                        ? "bg-[#1F8A8A]/50"
                        : "bg-[#153030]"
                    }`}
                  >
                    <Icon
                      className={`w-3.5 h-3.5 ${
                        isCurrent
                          ? "text-white"
                          : isPast && !isCancelled
                          ? "text-[#3CC8C8]"
                          : "text-white/40"
                      }`}
                    />
                  </div>
                  <div className="py-2">
                    <p
                      className={`text-sm font-medium ${
                        isCurrent
                          ? "text-[#3CC8C8]"
                          : isPast && !isCancelled
                          ? "text-white/80"
                          : "text-white/40"
                      }`}
                    >
                      {getStatusLabel(status)}
                    </p>
                  </div>
                </div>
              );
            })}
            {order.order_status === "cancelled" && (
              <div className="flex items-center gap-3">
                <div className="relative z-10 w-[30px] h-[30px] rounded-full flex items-center justify-center shrink-0 bg-red-600 ring-2 ring-red-500/30">
                  <XCircle className="w-3.5 h-3.5 text-white" />
                </div>
                <p className="text-sm font-medium text-red-400 py-2">Dibatalkan</p>
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Actions */}
      {nextStatuses.length > 0 && (
        <Card>
          <CardContent className="p-4 space-y-3">
            <h3 className="text-xs font-medium text-white/50 uppercase tracking-wider">
              Aksi
            </h3>
            <div className="grid grid-cols-1 gap-2">
              {nextStatuses.map((status) => {
                const Icon = STATUS_ICONS[status] || Clock;
                return (
                  <Button
                    key={status}
                    variant={status === "cancelled" ? "destructive" : "default"}
                    className="w-full justify-between h-12"
                    onClick={() => handleStatusUpdate(status)}
                    disabled={updating !== null}
                  >
                    <span className="flex items-center gap-2">
                      {updating === status ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                      ) : (
                        <Icon className="w-4 h-4" />
                      )}
                      {status === "cancelled"
                        ? "Batalkan Pesanan"
                        : `Ubah ke ${getStatusLabel(status)}`}
                    </span>
                    <ChevronRight className="w-4 h-4" />
                  </Button>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Meta */}
      <div className="flex items-center gap-2 text-xs text-white/40 pb-4">
        <span className="capitalize">{order.fulfillment_method}</span>
        {order.delivery_provider && (
          <>
            <span>·</span>
            <span>{order.delivery_provider}</span>
          </>
        )}
        <span>·</span>
        <span>Update: {formatDateTime(order.updated_at)}</span>
      </div>
    </div>
  );
}
