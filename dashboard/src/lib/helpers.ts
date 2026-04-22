/**
 * Shared formatting & display helpers for the Go Ngupi dashboard.
 * Kept separate from utils.ts (which only exports `cn`) so that
 * utils.ts stays untouched per project rules.
 */

// ── Currency ────────────────────────────────────────────────────
export function formatRupiah(amount: number): string {
  return new Intl.NumberFormat("id-ID", {
    style: "currency",
    currency: "IDR",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount);
}

// ── Date / Time ─────────────────────────────────────────────────
export function formatTime(dateStr: string): string {
  const d = new Date(dateStr);
  return d.toLocaleTimeString("id-ID", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Asia/Jakarta",
  });
}

export function formatDateTime(dateStr: string): string {
  const d = new Date(dateStr);
  return d.toLocaleString("id-ID", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Asia/Jakarta",
  });
}

// ── Order status ────────────────────────────────────────────────
const STATUS_LABELS: Record<string, string> = {
  awaiting_payment: "Menunggu Bayar",
  ready_to_submit: "Siap Diproses",
  preparing: "Sedang Dibuat",
  ready_for_pickup: "Siap Diambil",
  picked_up: "Sudah Diambil",
  on_the_way: "Sedang Diantar",
  delivered: "Terkirim",
  completed: "Selesai",
  cancelled: "Dibatalkan",
};

export function getStatusLabel(status: string): string {
  return STATUS_LABELS[status] ?? status;
}

export function getStatusColor(status: string): string {
  switch (status) {
    case "awaiting_payment":
      return "bg-amber-500/15 text-amber-400 border-amber-500/25";
    case "ready_to_submit":
      return "bg-blue-500/15 text-blue-400 border-blue-500/25";
    case "preparing":
      return "bg-orange-500/15 text-orange-400 border-orange-500/25";
    case "ready_for_pickup":
      return "bg-cyan-500/15 text-cyan-300 border-cyan-500/25";
    case "picked_up":
      return "bg-indigo-500/15 text-indigo-400 border-indigo-500/25";
    case "on_the_way":
      return "bg-purple-500/15 text-purple-400 border-purple-500/25";
    case "delivered":
      return "bg-teal-500/15 text-teal-400 border-teal-500/25";
    case "completed":
      return "bg-green-500/15 text-green-400 border-green-500/25";
    case "cancelled":
      return "bg-red-500/15 text-red-400 border-red-500/25";
    default:
      return "bg-white/10 text-white/60 border-white/20";
  }
}

// ── Payment status ──────────────────────────────────────────────
export function getPaymentStatusLabel(status: string): string {
  switch (status) {
    case "pending":
      return "Belum Bayar";
    case "confirmed":
      return "Lunas";
    default:
      return status;
  }
}

export function getPaymentStatusColor(status: string): string {
  switch (status) {
    case "pending":
      return "bg-amber-500/15 text-amber-400 border-amber-500/25";
    case "confirmed":
      return "bg-green-500/15 text-green-400 border-green-500/25";
    default:
      return "bg-white/10 text-white/60 border-white/20";
  }
}

// ── External links ──────────────────────────────────────────────
export function formatWhatsAppLink(phone: string): string {
  const cleaned = phone.replace(/[^0-9]/g, "");
  return `https://wa.me/${cleaned}`;
}

export function formatGoogleMapsLink(lat: number, lng: number): string {
  return `https://www.google.com/maps?q=${lat},${lng}`;
}
