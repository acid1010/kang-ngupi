"use client";

import { useEffect, useState } from "react";
import { useRouter, usePathname } from "next/navigation";
import { useAuth } from "@/lib/auth-context";
import {
  LayoutDashboard,
  Package,
  Users,
  LogOut,
  Menu,
  X,
} from "lucide-react";
import Link from "next/link";
import { cn } from "@/lib/utils";

const navItems = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard, roles: ["admin", "kurir"] },
  { href: "/dashboard/orders", label: "Pesanan", icon: Package, roles: ["admin", "kurir"] },
  { href: "/dashboard/users", label: "Pengguna", icon: Users, roles: ["admin"] },
];

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { user, loading, logout } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  useEffect(() => {
    if (!loading && !user) {
      router.replace("/login");
    }
  }, [user, loading, router]);

  if (loading || !user) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="animate-spin text-[#2BB5B5]">
          <img src="/app/logo.jpg" alt="Ngupi" className="w-8 h-8 rounded-lg object-cover" />
        </div>
      </div>
    );
  }

  const filteredNav = navItems.filter((item) => item.roles.includes(user.role));

  return (
    <div className="min-h-screen bg-[#0d1b1b]">
      {/* Mobile header */}
      <header className="lg:hidden sticky top-0 z-50 bg-[#112626]/95 backdrop-blur-sm border-b border-[#1e4040]">
        <div className="flex items-center justify-between px-4 h-16">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-[#1F8A8A] to-[#164a4a] flex items-center justify-center">
              <img src="/app/logo.jpg" alt="Ngupi" className="w-5 h-5 rounded object-cover" />
            </div>
            <span className="font-bold text-[#3CC8C8]">Ngupi Express</span>
          </div>
          <button
            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
            className="p-2 text-white/60 hover:text-white/90 transition-colors"
          >
            {mobileMenuOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
          </button>
        </div>

        {/* Mobile menu */}
        {mobileMenuOpen && (
          <div className="border-t border-[#1e4040] bg-[#112626] pb-2">
            <nav className="px-2 pt-2 space-y-1">
              {filteredNav.map((item) => {
                const Icon = item.icon;
                const isActive = pathname === item.href || (item.href !== "/dashboard" && pathname.startsWith(item.href));
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    onClick={() => setMobileMenuOpen(false)}
                    className={cn(
                      "flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors",
                      isActive
                        ? "bg-[#1F8A8A]/20 text-[#3CC8C8]"
                        : "text-white/60 hover:text-white/90 hover:bg-[#153030]"
                    )}
                  >
                    <Icon className="w-5 h-5" />
                    {item.label}
                  </Link>
                );
              })}
              <button
                onClick={logout}
                className="flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium text-white/60 hover:text-red-400 hover:bg-[#153030] w-full transition-colors"
              >
                <LogOut className="w-5 h-5" />
                Keluar
              </button>
            </nav>
            <div className="px-4 pt-3 mt-2 border-t border-[#1e4040]">
              <p className="text-xs text-white/50">
                Login sebagai <span className="text-white/80">{user.name}</span>
                <span className="ml-1 text-[#1F8A8A]">({user.role})</span>
              </p>
            </div>
          </div>
        )}
      </header>

      <div className="flex">
        {/* Desktop sidebar */}
        <aside className="hidden lg:flex lg:flex-col lg:w-64 lg:fixed lg:inset-y-0 bg-[#112626] border-r border-[#1e4040]">
          <div className="flex items-center gap-3 px-6 h-16 border-b border-[#1e4040]">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-[#1F8A8A] to-[#164a4a] flex items-center justify-center shadow-lg">
              <img src="/app/logo.jpg" alt="Ngupi" className="w-7 h-7 rounded-lg object-cover" />
            </div>
            <div>
              <h1 className="font-bold text-[#3CC8C8] text-lg leading-tight">Ngupi Express</h1>
              <p className="text-[10px] text-white/50 uppercase tracking-wider">Dashboard</p>
            </div>
          </div>

          <nav className="flex-1 px-3 py-4 space-y-1">
            {filteredNav.map((item) => {
              const Icon = item.icon;
              const isActive = pathname === item.href || (item.href !== "/dashboard" && pathname.startsWith(item.href));
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={cn(
                    "flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all",
                    isActive
                      ? "bg-[#1F8A8A]/20 text-[#3CC8C8] shadow-sm"
                      : "text-white/60 hover:text-white/90 hover:bg-[#153030]/50"
                  )}
                >
                  <Icon className="w-5 h-5" />
                  {item.label}
                </Link>
              );
            })}
          </nav>

          <div className="p-4 border-t border-[#1e4040]">
            <div className="flex items-center justify-between mb-3">
              <div>
                <p className="text-sm font-medium text-white/90">{user.name}</p>
                <p className="text-xs text-[#1F8A8A] capitalize">{user.role}</p>
              </div>
            </div>
            <button
              onClick={logout}
              className="flex items-center gap-2 text-sm text-white/50 hover:text-red-400 transition-colors w-full"
            >
              <LogOut className="w-4 h-4" />
              Keluar
            </button>
          </div>
        </aside>

        {/* Main content */}
        <main className="flex-1 lg:ml-64 min-h-screen">
          <div className="p-4 lg:p-6 max-w-7xl mx-auto">
            {children}
          </div>
        </main>
      </div>
    </div>
  );
}
