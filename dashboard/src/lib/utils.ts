import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatRupiah(amount: number): string {
  return new Intl.NumberFormat("id-ID", {
    style: "currency",
    currency: "IDR",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount);
}

export function formatPhone(phone: string): string {
  return phone.startsWith("+62") ? phone : `+62${phone}`;
}

export function formatWhatsAppLink(phone: string): string {
  const clean = phone.replace(/[^0-9]/g, "");
  return `https://wa.me/${clean}`;
}

export function formatGoogleMapsLink(lat: number, lng: number): string {
  return `https://maps.google.com/?q=${lat},${lng}`;
}

export function formatDateTime(dateStr: string): string {
  const date = new Date(dateStr);
  return new Intl.DateTimeFormat("id-ID", {
    timeZone: "Asia/Jakarta",
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

export function formatTime(dateStr: string): string {
  const date = new Date(dateStr);
  return new Intl.DateTimeFormat("id-ID", {
    timeZone: "Asia/Jakarta",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

export function getStatusLabel(status: string): string {
  const labels: Record<string, string> = {
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
  return labels[status] || status;
}

export function getPaymentStatusLabel(status: string): string {
  return status === "confirmed" ? "Lunas" : "Belum Bayar";
}

export function getStatusColor(status: string): string {
  const colors: Record<string, string> = {
    awaiting_payment: "bg-yellow-500/20 text-yellow-400 border-yellow-500/30",
    ready_to_submit: "bg-blue-500/20 text-blue-400 border-blue-500/30",
    preparing: "bg-orange-500/20 text-orange-400 border-orange-500/30",
    ready_for_pickup: "bg-cyan-500/20 text-cyan-400 border-cyan-500/30",
    picked_up: "bg-indigo-500/20 text-indigo-400 border-indigo-500/30",
    on_the_way: "bg-purple-500/20 text-purple-400 border-purple-500/30",
    delivered: "bg-emerald-500/20 text-emerald-400 border-emerald-500/30",
    completed: "bg-green-500/20 text-green-400 border-green-500/30",
    cancelled: "bg-red-500/20 text-red-400 border-red-500/30",
  };
  return colors[status] || "bg-gray-500/20 text-gray-400 border-gray-500/30";
}

export function getPaymentStatusColor(status: string): string {
  return status === "confirmed"
    ? "bg-green-500/20 text-green-400 border-green-500/30"
    : "bg-yellow-500/20 text-yellow-400 border-yellow-500/30";
}
