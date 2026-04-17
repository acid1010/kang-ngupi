"use client";

import { useState } from "react";
import { Order, updateOrderStatus } from "@/lib/api";
import { Button } from "@/components/ui/button";
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
  X,
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
  "preparing",
  "on_the_way",
  "completed",
];

const STATUS_ICONS: Record<string, React.ElementType> = {
  awaiting_payment: CreditCard,
  ready_to_submit: Clock,
  preparing: Coffee,
  ready_for_pickup: PackageCheck,
  on_the_way: Navigation,
  completed: CheckCircle2,
  cancelled: XCircle,
};

function getNextStatuses(current: string, fulfillment?: string): string[] {
  if (current === "cancelled" || current === "completed") return [];
  
  // Simplified 3-step flow
  if (current === "awaiting_payment" || current === "ready_to_submit") {
    return ["preparing", "cancelled"];
  }
  if (current === "preparing") {
    if (fulfillment === "pickup") {
      return ["completed", "cancelled"]; // Pickup: ready → done
    }
    return ["on_the_way", "cancelled"]; // Delivery: preparing → diantar
  }
  if (current === "on_the_way") {
    return ["completed", "cancelled"];
  }
  return ["cancelled"];
}

interface OrderDetailModalProps {
  order: Order;
  onClose: () => void;
  onStatusUpdate: (order: Order) => void;
}

export function OrderDetailModal({
  order,
  onClose,
  onStatusUpdate,
}: OrderDetailModalProps) {
  const [updating, setUpdating] = useState<string | null>(null);

  async function handleStatusUpdate(newStatus: string) {
    setUpdating(newStatus);
    try {
      const updated = await updateOrderStatus(order.id, newStatus);
      // Merge with existing order data (PATCH response doesn't include items/payment)
      const merged = { ...order, ...updated, items: order.items, payment: order.payment };
      toast.success(`Status diubah ke ${getStatusLabel(newStatus)}`);
      onStatusUpdate(merged);
    } catch {
      toast.error("Gagal mengubah status");
    } finally {
      setUpdating(null);
    }
  }

  const nextStatuses = getNextStatuses(order.order_status, order.fulfillment_method);
  const currentIdx = STATUS_FLOW.indexOf(order.order_status);

  return (
    <div className="fixed inset-0 z-50 flex items-end lg:items-center justify-center">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Modal */}
      <div className="relative w-full max-w-lg max-h-[85vh] lg:max-h-[90vh] overflow-y-auto bg-[#112626] border border-[#1e4040] rounded-t-2xl lg:rounded-2xl shadow-2xl pb-safe">
        {/* Mobile swipe indicator */}
        <div className="lg:hidden flex justify-center pt-2 pb-0">
          <div className="w-10 h-1 rounded-full bg-white/20" />
        </div>
        {/* Header */}
        <div className="sticky top-0 bg-[#112626]/95 backdrop-blur-sm border-b border-[#1e4040] px-4 py-3 flex items-center justify-between z-10">
          <div>
            <h2 className="font-bold text-white">Detail Pesanan</h2>
            <p className="text-xs text-white/50">
              #{order.client_order_id || order.id}
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-lg text-white/60 hover:text-white/90 hover:bg-[#153030] transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-4 space-y-5">
          {/* Customer info */}
          <div className="space-y-2">
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
                  className="flex items-center gap-1.5 text-sm text-green-400 hover:text-green-300 transition-colors mt-0.5"
                >
                  <Phone className="w-3.5 h-3.5" />
                  {order.customer_phone_snapshot}
                  <ExternalLink className="w-3 h-3" />
                </a>
              </div>
              <div className="text-right">
                <p className="text-xs text-white/50">
                  {formatDateTime(order.created_at)}
                </p>
              </div>
            </div>
          </div>

          {/* Location */}
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
                  <p className="text-sm font-medium text-blue-300">
                    Lokasi Pengiriman
                  </p>
                  <p className="text-xs text-blue-400/70">
                    {order.location_lat.toFixed(6)}, {order.location_lng.toFixed(6)}
                  </p>
                </div>
                <ExternalLink className="w-4 h-4 text-blue-400" />
              </a>
            )}

          {/* Items */}
          <div className="space-y-2">
            <h3 className="text-xs font-medium text-white/50 uppercase tracking-wider">
              Pesanan
            </h3>
            <div className="space-y-2">
              {(order.items || []).map((item, i) => (
                <div
                  key={i}
                  className="flex items-center justify-between py-2 border-b border-[#1e4040]/50 last:border-0"
                >
                  <div>
                    <p className="text-sm font-medium text-white/90">
                      {item.menu_name}
                    </p>
                    {item.temperature && (
                      <p className="text-xs text-white/50">{item.temperature}</p>
                    )}
                  </div>
                  <span className="text-sm text-white/60">x{item.qty}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Payment */}
          <div className="space-y-2">
            <h3 className="text-xs font-medium text-white/50 uppercase tracking-wider">
              Pembayaran
            </h3>
            <div className="flex items-center justify-between p-3 rounded-xl bg-[#153030]/50">
              <div className="flex items-center gap-3">
                <div className="flex gap-2">
                  <Badge className={getPaymentStatusColor(order.payment_status)}>
                    {getPaymentStatusLabel(order.payment_status)}
                  </Badge>
                  <Badge variant="outline" className="text-white/60 border-[#2a5555]">
                    {(order.payment_method || "-").toUpperCase()}
                  </Badge>
                </div>
              </div>
              <p className="font-bold text-[#3CC8C8] text-lg">
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
          </div>

          {/* Status timeline */}
          <div className="space-y-2">
            <h3 className="text-xs font-medium text-white/50 uppercase tracking-wider">
              Status
            </h3>
            <div className="space-y-0">
              {STATUS_FLOW.map((status, idx) => {
                const Icon = STATUS_ICONS[status] || Clock;
                const isCurrent = status === order.order_status;
                const isPast = idx < currentIdx;
                const isFuture = idx > currentIdx;
                const isCancelled = order.order_status === "cancelled";

                return (
                  <div key={status} className="flex items-center gap-3 relative">
                    {/* Line */}
                    {idx < STATUS_FLOW.length - 1 && (
                      <div
                        className={`absolute left-[15px] top-[30px] w-0.5 h-[calc(100%-6px)] ${
                          isPast && !isCancelled
                            ? "bg-[#1F8A8A]"
                            : "bg-[#153030]"
                        }`}
                      />
                    )}
                    {/* Dot */}
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
                    {/* Label */}
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
                  <p className="text-sm font-medium text-red-400 py-2">
                    Dibatalkan
                  </p>
                </div>
              )}
            </div>
          </div>

          {/* Action buttons */}
          {nextStatuses.length > 0 && (
            <div className="space-y-2">
              <h3 className="text-xs font-medium text-white/50 uppercase tracking-wider">
                Aksi
              </h3>
              <div className="grid grid-cols-1 gap-2">
                {nextStatuses.map((status) => (
                  <Button
                    key={status}
                    variant={status === "cancelled" ? "destructive" : "default"}
                    className="w-full justify-between h-11"
                    onClick={() => handleStatusUpdate(status)}
                    disabled={updating !== null}
                  >
                    <span className="flex items-center gap-2">
                      {updating === status ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                      ) : (
                        (() => {
                          const Icon = STATUS_ICONS[status] || Clock;
                          return <Icon className="w-4 h-4" />;
                        })()
                      )}
                      {status === "cancelled"
                        ? "Batalkan Pesanan"
                        : `Ubah ke ${getStatusLabel(status)}`}
                    </span>
                    <ChevronRight className="w-4 h-4" />
                  </Button>
                ))}
              </div>
            </div>
          )}

          {/* Fulfillment & delivery info */}
          <div className="flex items-center gap-2 text-xs text-white/40 pt-2 border-t border-[#1e4040]">
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
      </div>
    </div>
  );
}
