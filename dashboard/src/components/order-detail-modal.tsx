"use client";

import { useState } from "react";
import { Order, updateOrderStatus } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  formatRupiah,
  formatDateTime,
  formatWhatsAppLink,
  formatGoogleMapsLink,
  getStatusLabel,
  getStatusColor,
  getPaymentStatusLabel,
  getPaymentStatusColor,
  getFulfillmentLabel,
} from "@/lib/helpers";
import {
  Phone,
  MapPin,
  ExternalLink,
  Loader2,
  ChevronRight,
  CreditCard,
  ShoppingBag,
  CheckCircle2,
  Clock,
  XCircle,
  Coffee,
  PackageCheck,
  Navigation,
  Truck,
  UtensilsCrossed,
} from "lucide-react";
import { toast } from "sonner";

const STATUS_FLOW = [
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

  // Simplified 2-step: Sedang Diantar → Selesai
  if (current === "on_the_way") {
    return ["completed", "cancelled"];
  }
  // Any other status → Sedang Diantar
  return ["on_the_way", "cancelled"];
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
      const merged = { ...order, ...updated, items: order.items, payment: order.payment };
      toast.success(`Status diubah ke ${getStatusLabel(newStatus)}`);
      onStatusUpdate(merged);
      if (newStatus === "completed" || newStatus === "cancelled") {
        onClose();
      }
    } catch {
      toast.error("Gagal mengubah status");
    } finally {
      setUpdating(null);
    }
  }

  const nextStatuses = getNextStatuses(order.order_status, order.fulfillment_method);
  const currentIdx = STATUS_FLOW.indexOf(order.order_status);

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        className="sm:max-w-lg max-h-[85vh] overflow-hidden bg-card border-border p-0"
        showCloseButton
      >
        <DialogHeader className="px-5 pt-5 pb-0">
          <DialogTitle className="text-foreground text-base">
            Detail Pesanan
          </DialogTitle>
          <DialogDescription className="text-muted-foreground font-mono text-xs">
            #{order.client_order_id || order.id}
          </DialogDescription>
        </DialogHeader>

        <ScrollArea className="max-h-[calc(85vh-80px)] px-5 pb-5">
          <div className="space-y-5">
            {/* ── Customer ─────────────────────────────────────── */}
            <section className="space-y-2.5">
              <h3 className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">
                Customer
              </h3>
              <div className="flex items-center justify-between">
                <div>
                  <p className="font-semibold text-foreground text-lg leading-tight">
                    {order.customer_name_snapshot}
                  </p>
                  <a
                    href={formatWhatsAppLink(order.customer_phone_snapshot)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 text-sm text-green-400 hover:text-green-300 transition-colors mt-1"
                  >
                    <Phone className="w-3.5 h-3.5" />
                    {order.customer_phone_snapshot}
                    <ExternalLink className="w-3 h-3" />
                  </a>
                </div>
                <div className="text-right">
                  <Badge variant="outline" className="capitalize text-muted-foreground border-border">
                    {order.fulfillment_method === "delivery" ? (
                      <Truck className="w-3 h-3 mr-1" />
                    ) : order.fulfillment_method === "dine_in" ? (
                      <UtensilsCrossed className="w-3 h-3 mr-1" />
                    ) : (
                      <ShoppingBag className="w-3 h-3 mr-1" />
                    )}
                    {getFulfillmentLabel(order.fulfillment_method)}
                  </Badge>
                  {order.fulfillment_method === "dine_in" && order.table_number ? (
                    <p className="text-[11px] text-[var(--ngupi)] mt-1.5">Meja {order.table_number}</p>
                  ) : null}
                  <p className="text-[11px] text-muted-foreground/60 mt-1.5">
                    {formatDateTime(order.created_at)}
                  </p>
                </div>
              </div>
            </section>

            {/* ── Location ─────────────────────────────────────── */}
            {order.fulfillment_method === "delivery" &&
              order.location_lat &&
              order.location_lng && (
                <a
                  href={formatGoogleMapsLink(order.location_lat, order.location_lng)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-3 p-3 rounded-xl bg-blue-500/8 border border-blue-500/15 hover:bg-blue-500/12 transition-colors"
                >
                  <div className="p-2 rounded-lg bg-blue-500/15">
                    <MapPin className="w-4 h-4 text-blue-400" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-blue-300">Lokasi Pengiriman</p>
                    <p className="text-xs text-blue-400/60 font-mono">
                      {order.location_lat.toFixed(6)}, {order.location_lng.toFixed(6)}
                    </p>
                  </div>
                  <ExternalLink className="w-4 h-4 text-blue-400/60 shrink-0" />
                </a>
              )}

            <Separator className="bg-border" />

            {/* ── Items ────────────────────────────────────────── */}
            <section className="space-y-2.5">
              <h3 className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">
                Pesanan
              </h3>
              <div className="space-y-0">
                {(order.items || []).map((item, i) => (
                  <div
                    key={i}
                    className="flex items-center justify-between py-2.5 border-b border-border/50 last:border-0"
                  >
                    <div>
                      <p className="text-sm font-medium text-foreground/90">
                        {item.menu_name}
                      </p>
                      {item.temperature && (
                        <p className="text-xs text-muted-foreground">{item.temperature}</p>
                      )}
                    </div>
                    <span className="text-sm text-muted-foreground font-medium tabular-nums">
                      x{item.qty}
                    </span>
                  </div>
                ))}
              </div>
            </section>

            <Separator className="bg-border" />

            {/* ── Payment ──────────────────────────────────────── */}
            <section className="space-y-2.5">
              <h3 className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">
                Pembayaran
              </h3>
              <div className="flex items-center justify-between p-3 rounded-xl bg-secondary/50 ring-1 ring-border/50">
                <div className="flex items-center gap-2">
                  <Badge className={getPaymentStatusColor(order.payment_status)}>
                    {getPaymentStatusLabel(order.payment_status)}
                  </Badge>
                  <Badge variant="outline" className="text-muted-foreground border-border text-[11px]">
                    {(order.payment_method || "-").toUpperCase()}
                  </Badge>
                </div>
                <p className="font-bold text-[var(--ngupi)] text-lg tabular-nums">
                  {order.payment?.total_payment
                    ? formatRupiah(order.payment.total_payment)
                    : order.payment?.amount
                    ? formatRupiah(order.payment.amount)
                    : "-"}
                </p>
              </div>
              {order.payment?.paid_at && (
                <p className="text-xs text-muted-foreground">
                  Dibayar: {formatDateTime(order.payment.paid_at)}
                </p>
              )}
            </section>

            <Separator className="bg-border" />

            {/* ── Status timeline ──────────────────────────────── */}
            <section className="space-y-2.5">
              <h3 className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">
                Status
              </h3>
              <div className="space-y-0 pl-1">
                {STATUS_FLOW.map((status, idx) => {
                  const Icon = STATUS_ICONS[status] || Clock;
                  const isCurrent = status === order.order_status;
                  const isPast = idx < currentIdx;
                  const isCancelled = order.order_status === "cancelled";

                  return (
                    <div key={status} className="flex items-center gap-3 relative">
                      {idx < STATUS_FLOW.length - 1 && (
                        <div
                          className={`absolute left-[13px] top-[28px] w-0.5 h-[calc(100%-4px)] transition-colors ${
                            isPast && !isCancelled
                              ? "bg-[var(--ngupi-darker)]"
                              : "bg-border/50"
                          }`}
                        />
                      )}
                      <div
                        className={`relative z-10 w-[26px] h-[26px] rounded-full flex items-center justify-center shrink-0 transition-all ${
                          isCurrent
                            ? "bg-[var(--ngupi-darker)] ring-2 ring-[var(--ngupi)]/25 shadow-sm shadow-[var(--ngupi)]/20"
                            : isPast && !isCancelled
                            ? "bg-[var(--ngupi-darker)]/40"
                            : "bg-secondary"
                        }`}
                      >
                        <Icon
                          className={`w-3 h-3 ${
                            isCurrent
                              ? "text-white"
                              : isPast && !isCancelled
                              ? "text-[var(--ngupi)]"
                              : "text-muted-foreground/50"
                          }`}
                        />
                      </div>
                      <div className="py-1.5">
                        <p
                          className={`text-sm font-medium ${
                            isCurrent
                              ? "text-[var(--ngupi)]"
                              : isPast && !isCancelled
                              ? "text-foreground/70"
                              : "text-muted-foreground/50"
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
                    <div className="relative z-10 w-[26px] h-[26px] rounded-full flex items-center justify-center shrink-0 bg-red-600 ring-2 ring-red-500/25">
                      <XCircle className="w-3 h-3 text-white" />
                    </div>
                    <p className="text-sm font-medium text-red-400 py-1.5">
                      Dibatalkan
                    </p>
                  </div>
                )}
              </div>
            </section>

            {/* ── Action buttons ────────────────────────────────── */}
            {nextStatuses.length > 0 && (
              <>
                <Separator className="bg-border" />
                <section className="space-y-2.5">
                  <h3 className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">
                    Aksi
                  </h3>
                  <div className="grid grid-cols-1 gap-2">
                    {nextStatuses.map((status) => {
                      const Icon = STATUS_ICONS[status] || Clock;
                      const isCancelAction = status === "cancelled";
                      return (
                        <Button
                          key={status}
                          variant={isCancelAction ? "destructive" : "default"}
                          size="lg"
                          className="w-full justify-between"
                          onClick={() => handleStatusUpdate(status)}
                          disabled={updating !== null}
                        >
                          <span className="flex items-center gap-2">
                            {updating === status ? (
                              <Loader2 className="w-4 h-4 animate-spin" />
                            ) : (
                              <Icon className="w-4 h-4" />
                            )}
                            {isCancelAction
                              ? "Batalkan Pesanan"
                              : `Ubah ke ${getStatusLabel(status)}`}
                          </span>
                          <ChevronRight className="w-4 h-4 opacity-50" />
                        </Button>
                      );
                    })}
                  </div>
                </section>
              </>
            )}

            {/* ── Meta footer ──────────────────────────────────── */}
            <div className="flex items-center gap-2 text-[11px] text-muted-foreground/50 pt-2">
              <span>
                {order.fulfillment_method === "dine_in" && order.table_number
                  ? `Meja ${order.table_number}`
                  : getFulfillmentLabel(order.fulfillment_method)}
              </span>
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
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}
