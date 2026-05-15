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
  Navigation,
} from "lucide-react";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
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
  { href: "/kurir", label: "Courier", icon: Navigation, roles: ["admin", "kurir"] },
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard, roles: ["admin"] },
  { href: "/dashboard/orders", label: "Orders", icon: Package, roles: ["admin"] },
  { href: "/dashboard/users", label: "Users", icon: Users, roles: ["admin"] },
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
        "flex items-center gap-3 px-3.5 py-2.5 rounded-xl text-[13px] font-medium transition-all duration-300 group relative",
        isActive
          ? "bg-[var(--ngupi)]/10 text-[var(--ngupi)] shadow-sm shadow-[var(--ngupi)]/5"
          : "text-muted-foreground hover:text-foreground hover:bg-white/[0.03]"
      )}
    >
      {isActive && (
        <span className="absolute left-0 top-1/2 -translate-y-1/2 w-[3px] h-5 rounded-r-full bg-[var(--ngupi)]" />
      )}
      <Icon className={cn("w-[17px] h-[17px] transition-colors duration-300", isActive ? "text-[var(--ngupi)]" : "group-hover:text-foreground")} />
      <span className="flex-1">{item.label}</span>
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
    <div className="border-t border-border/50 pt-4 space-y-3">
      <div className="flex items-center gap-3 px-1">
        <Avatar size="default">
          <AvatarFallback className="bg-[var(--ngupi)]/10 text-[var(--ngupi)] text-[11px] font-semibold ring-1 ring-[var(--ngupi)]/20">
            {initials}
          </AvatarFallback>
        </Avatar>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-foreground truncate leading-tight">{user.name || user.username || "User"}</p>
          <p className="text-[11px] text-muted-foreground capitalize leading-tight mt-0.5">{user.role}</p>
        </div>
      </div>
      <Button
        variant="ghost"
        size="sm"
        onClick={onLogout}
        className="w-full justify-start text-muted-foreground/70 hover:text-red-400 hover:bg-red-500/[0.06] rounded-lg text-xs h-8"
      >
        <LogOut className="w-3.5 h-3.5 mr-2" />
        Sign Out
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
        <div className="flex flex-col items-center gap-4">
          <div className="w-11 h-11 rounded-xl overflow-hidden animate-pulse ring-1 ring-border">
            <img src="/logo.jpg" alt="Go Ngupi" className="w-full h-full object-cover" />
          </div>
          <div className="flex items-center gap-2">
            <div className="w-1.5 h-1.5 rounded-full bg-[var(--ngupi)] animate-pulse" />
            <p className="text-xs text-muted-foreground font-light">Loading</p>
          </div>
        </div>
      </div>
    );
  }

  const filteredNav = navItems.filter((item) => item.roles.includes(user.role));

  const isActive = (href: string) =>
    pathname === href || (href !== "/dashboard" && pathname.startsWith(href));

  return (
    <div className="min-h-screen bg-background">
      {/* Mobile header */}
      <header className="lg:hidden sticky top-0 z-50 bg-background/90 backdrop-blur-xl border-b border-border/50">
        <div className="flex items-center justify-between px-4 h-14">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg overflow-hidden ring-1 ring-border/60">
              <img src="/logo.jpg" alt="Go Ngupi" className="w-full h-full object-cover" />
            </div>
            <span className="font-bold text-[var(--ngupi)] text-[15px] tracking-tight">Go Ngupi</span>
          </div>

          <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
            <SheetTrigger
              render={
                <Button variant="ghost" size="icon" className="text-muted-foreground hover:text-foreground">
                  <Menu className="w-5 h-5" />
                </Button>
              }
            />
            <SheetContent
              side="left"
              className="w-[260px] bg-background border-border/50 p-0"
              showCloseButton={false}
            >
              <SheetHeader className="px-5 pt-6 pb-4">
                <div className="flex items-center gap-2.5">
                  <div className="w-9 h-9 rounded-xl overflow-hidden ring-1 ring-border/60">
                    <img src="/logo.jpg" alt="Go Ngupi" className="w-full h-full object-cover" />
                  </div>
                  <div>
                    <SheetTitle className="text-[var(--ngupi)] text-[15px] font-bold leading-tight tracking-tight">
                      Go Ngupi
                    </SheetTitle>
                    <p className="text-[10px] text-muted-foreground/60 uppercase tracking-widest mt-0.5">
                      Operations
                    </p>
                  </div>
                </div>
              </SheetHeader>

              <div className="h-px bg-border/40 mx-4" />

              <ScrollArea className="flex-1 px-3 py-4">
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

              <div className="px-4 pb-5 mt-auto">
                <UserBlock user={user} onLogout={logout} />
              </div>
            </SheetContent>
          </Sheet>
        </div>
      </header>

      <div className="flex">
        {/* Desktop sidebar */}
        <aside className="hidden lg:flex lg:flex-col lg:w-[240px] lg:fixed lg:inset-y-0 bg-background border-r border-border/40">
          {/* Logo */}
          <div className="flex items-center gap-3 px-5 h-16 border-b border-border/30">
            <div className="w-9 h-9 rounded-xl overflow-hidden ring-1 ring-border/50 shadow-lg shadow-black/20">
              <img src="/logo.jpg" alt="Go Ngupi" className="w-full h-full object-cover" />
            </div>
            <div>
              <h1 className="font-bold text-[var(--ngupi)] text-[15px] leading-tight tracking-tight">Go Ngupi</h1>
              <p className="text-[10px] text-muted-foreground/50 uppercase tracking-widest mt-0.5">Operations</p>
            </div>
          </div>

          {/* Nav */}
          <ScrollArea className="flex-1 px-3 py-5">
            <nav className="space-y-1">
              {filteredNav.map((item) => (
                <NavLink key={item.href} item={item} isActive={isActive(item.href)} />
              ))}
            </nav>
          </ScrollArea>

          {/* User */}
          <div className="px-4 pb-5">
            <UserBlock user={user} onLogout={logout} />
          </div>
        </aside>

        {/* Main content */}
        <main className="flex-1 lg:ml-[240px] min-h-screen">
          <div className="p-4 lg:p-8 max-w-[1400px] mx-auto">
            {children}
          </div>
        </main>
      </div>
    </div>
  );
}
