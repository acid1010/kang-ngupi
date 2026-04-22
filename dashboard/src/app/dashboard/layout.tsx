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
  ChevronRight,
} from "lucide-react";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  Sheet,
  SheetTrigger,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetClose,
} from "@/components/ui/sheet";
import { ScrollArea } from "@/components/ui/scroll-area";

const navItems = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard, roles: ["admin", "kurir"] },
  { href: "/dashboard/orders", label: "Pesanan", icon: Package, roles: ["admin", "kurir"] },
  { href: "/dashboard/users", label: "Pengguna", icon: Users, roles: ["admin"] },
];

function NavLink({
  item,
  isActive,
  onClick,
}: {
  item: (typeof navItems)[0];
  isActive: boolean;
  onClick?: () => void;
}) {
  const Icon = item.icon;
  return (
    <Link
      href={item.href}
      onClick={onClick}
      className={cn(
        "flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all group",
        isActive
          ? "bg-[var(--ngupi)]/12 text-[var(--ngupi)]"
          : "text-muted-foreground hover:text-foreground hover:bg-secondary"
      )}
    >
      <Icon className={cn("w-[18px] h-[18px]", isActive && "text-[var(--ngupi)]")} />
      <span className="flex-1">{item.label}</span>
      {isActive && <ChevronRight className="w-3.5 h-3.5 opacity-50" />}
    </Link>
  );
}

function UserBlock({ user, onLogout }: { user: { name?: string; username?: string; role: string }; onLogout: () => void }) {
  const initials = (user.name || user.username || "?")
    .split(" ")
    .map((w) => w[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

  return (
    <div className="space-y-3">
      <Separator className="bg-border" />
      <div className="flex items-center gap-3 px-1">
        <Avatar size="default">
          <AvatarFallback className="bg-[var(--ngupi)]/15 text-[var(--ngupi)] text-xs font-semibold">
            {initials}
          </AvatarFallback>
        </Avatar>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-foreground truncate">{user.name || user.username || "User"}</p>
          <p className="text-xs text-[var(--ngupi-darker)] capitalize">{user.role}</p>
        </div>
      </div>
      <Button
        variant="ghost"
        size="sm"
        onClick={onLogout}
        className="w-full justify-start text-muted-foreground hover:text-red-400 hover:bg-red-500/10"
      >
        <LogOut className="w-4 h-4 mr-2" />
        Keluar
      </Button>
    </div>
  );
}

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { user, loading, logout } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const [sheetOpen, setSheetOpen] = useState(false);

  useEffect(() => {
    if (!loading && !user) {
      router.replace("/login");
    }
  }, [user, loading, router]);

  if (loading || !user) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-background">
        <div className="flex flex-col items-center gap-3">
          <div className="w-10 h-10 rounded-xl overflow-hidden animate-pulse">
            <img src="/app/logo.jpg" alt="Ngupi" className="w-full h-full object-cover" />
          </div>
          <p className="text-xs text-muted-foreground">Memuat...</p>
        </div>
      </div>
    );
  }

  const filteredNav = navItems.filter((item) => item.roles.includes(user.role));

  const isActive = (href: string) =>
    pathname === href || (href !== "/dashboard" && pathname.startsWith(href));

  return (
    <div className="min-h-screen bg-background">
      {/* ── Mobile header ──────────────────────────────────────── */}
      <header className="lg:hidden sticky top-0 z-50 bg-card/95 backdrop-blur-md border-b border-border">
        <div className="flex items-center justify-between px-4 h-14">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg overflow-hidden ring-1 ring-border">
              <img src="/app/logo.jpg" alt="Ngupi" className="w-full h-full object-cover" />
            </div>
            <span className="font-bold text-[var(--ngupi)] text-base">Go Ngupi</span>
          </div>

          <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
            <SheetTrigger
              render={
                <Button variant="ghost" size="icon">
                  <Menu className="w-5 h-5" />
                </Button>
              }
            />
            <SheetContent
              side="left"
              className="w-[280px] bg-card border-border p-0"
              showCloseButton={false}
            >
              <SheetHeader className="px-5 pt-5 pb-3">
                <div className="flex items-center gap-2.5">
                  <div className="w-9 h-9 rounded-xl overflow-hidden ring-1 ring-border">
                    <img src="/app/logo.jpg" alt="Ngupi" className="w-full h-full object-cover" />
                  </div>
                  <div>
                    <SheetTitle className="text-[var(--ngupi)] text-base font-bold leading-tight">
                      Go Ngupi
                    </SheetTitle>
                    <p className="text-[10px] text-muted-foreground uppercase tracking-wider">
                      Dashboard
                    </p>
                  </div>
                </div>
              </SheetHeader>

              <Separator className="bg-border" />

              <ScrollArea className="flex-1 px-3 py-3">
                <nav className="space-y-1">
                  {filteredNav.map((item) => (
                    <SheetClose key={item.href} render={<div />}>
                      <NavLink
                        item={item}
                        isActive={isActive(item.href)}
                        onClick={() => setSheetOpen(false)}
                      />
                    </SheetClose>
                  ))}
                </nav>
              </ScrollArea>

              <div className="px-4 pb-4 mt-auto">
                <UserBlock user={user} onLogout={logout} />
              </div>
            </SheetContent>
          </Sheet>
        </div>
      </header>

      <div className="flex">
        {/* ── Desktop sidebar ────────────────────────────────────── */}
        <aside className="hidden lg:flex lg:flex-col lg:w-60 lg:fixed lg:inset-y-0 bg-card border-r border-border">
          {/* Logo */}
          <div className="flex items-center gap-3 px-5 h-14 border-b border-border">
            <div className="w-9 h-9 rounded-xl overflow-hidden ring-1 ring-border shadow-lg shadow-black/20">
              <img src="/app/logo.jpg" alt="Ngupi" className="w-full h-full object-cover" />
            </div>
            <div>
              <h1 className="font-bold text-[var(--ngupi)] text-base leading-tight">Go Ngupi</h1>
              <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Dashboard</p>
            </div>
          </div>

          {/* Nav */}
          <ScrollArea className="flex-1 px-3 py-4">
            <nav className="space-y-1">
              {filteredNav.map((item) => (
                <NavLink key={item.href} item={item} isActive={isActive(item.href)} />
              ))}
            </nav>
          </ScrollArea>

          {/* User */}
          <div className="px-4 pb-4">
            <UserBlock user={user} onLogout={logout} />
          </div>
        </aside>

        {/* ── Main content ───────────────────────────────────────── */}
        <main className="flex-1 lg:ml-60 min-h-screen">
          <div className="p-4 lg:p-6 max-w-7xl mx-auto">
            {children}
          </div>
        </main>
      </div>
    </div>
  );
}
