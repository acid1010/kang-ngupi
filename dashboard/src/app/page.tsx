"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth-context";

export default function Home() {
  const { user, loading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!loading) {
      if (user) {
        router.replace("/dashboard");
      } else {
        router.replace("/login");
      }
    }
  }, [user, loading, router]);

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
