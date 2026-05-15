"use client";

import { useState, FormEvent, useEffect } from "react";
import { useRouter } from "next/navigation";
import { login } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Eye, EyeOff, Loader2, ArrowRight } from "lucide-react";

export default function LoginPage() {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const { user, loading, loginSuccess } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!loading && user) {
      router.replace(user.role === "kurir" ? "/kurir" : "/dashboard");
    }
  }, [user, loading, router]);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError("");
    setIsLoading(true);

    try {
      const res = await login(username, password);
      loginSuccess(res.token, res.user);
      router.push(res.user.role === "kurir" ? "/kurir" : "/dashboard");
    } catch {
      setError("Invalid username or password");
    } finally {
      setIsLoading(false);
    }
  }

  if (loading) return null;

  return (
    <div className="min-h-screen flex items-center justify-center p-4 bg-background relative overflow-hidden">
      {/* Ambient background */}
      <div className="absolute inset-0 pointer-events-none" aria-hidden="true">
        <div className="absolute top-0 right-0 w-[600px] h-[600px] bg-[var(--ngupi)]/[0.03] rounded-full blur-[120px] translate-x-1/3 -translate-y-1/3" />
        <div className="absolute bottom-0 left-0 w-[500px] h-[500px] bg-[var(--ngupi-darker)]/[0.04] rounded-full blur-[100px] -translate-x-1/3 translate-y-1/3" />
      </div>

      {/* Grid pattern overlay */}
      <div
        className="absolute inset-0 pointer-events-none opacity-[0.015]"
        aria-hidden="true"
        style={{
          backgroundImage: `linear-gradient(var(--ngupi) 1px, transparent 1px), linear-gradient(90deg, var(--ngupi) 1px, transparent 1px)`,
          backgroundSize: "60px 60px",
        }}
      />

      <div className="w-full max-w-[380px] relative">
        {/* Brand header */}
        <div className="text-center mb-8">
          <div className="mx-auto mb-5 w-16 h-16 rounded-2xl overflow-hidden shadow-2xl shadow-black/40 ring-1 ring-white/[0.06] transition-transform duration-500 hover:scale-105">
            <img
              src="/logo.jpg"
              alt="Go Ngupi"
              className="w-full h-full object-cover"
            />
          </div>
          <h1 className="text-2xl font-bold text-foreground tracking-tight">
            Go Ngupi
          </h1>
          <p className="text-sm text-muted-foreground mt-1 font-light">
            Operations Dashboard
          </p>
        </div>

        {/* Login card */}
        <div className="rounded-2xl border border-border/60 bg-card/80 backdrop-blur-2xl shadow-2xl shadow-black/30 p-7">
          <form onSubmit={handleSubmit} className="space-y-5">
            {/* Error */}
            {error && (
              <div className="px-4 py-3 rounded-xl bg-red-500/[0.06] border border-red-500/15 text-red-400 text-sm text-center font-medium animate-in fade-in slide-in-from-top-1 duration-200">
                {error}
              </div>
            )}

            {/* Username */}
            <div className="space-y-2">
              <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                Username
              </label>
              <Input
                type="text"
                placeholder="Enter username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                required
                autoComplete="username"
                autoFocus
                className="h-12 bg-background/60 border-border/50 rounded-xl placeholder:text-muted-foreground/30 focus:border-[var(--ngupi)]/40 focus:ring-[var(--ngupi)]/15 focus:bg-background/80 transition-all duration-300 text-sm"
              />
            </div>

            {/* Password */}
            <div className="space-y-2">
              <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                Password
              </label>
              <div className="relative">
                <Input
                  type={showPassword ? "text" : "password"}
                  placeholder="Enter password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  autoComplete="current-password"
                  className="h-12 pr-11 bg-background/60 border-border/50 rounded-xl placeholder:text-muted-foreground/30 focus:border-[var(--ngupi)]/40 focus:ring-[var(--ngupi)]/15 focus:bg-background/80 transition-all duration-300 text-sm"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3.5 top-1/2 -translate-y-1/2 text-muted-foreground/50 hover:text-foreground/70 transition-colors duration-200"
                >
                  {showPassword ? (
                    <EyeOff className="w-4 h-4" />
                  ) : (
                    <Eye className="w-4 h-4" />
                  )}
                </button>
              </div>
            </div>

            {/* Submit */}
            <Button
              type="submit"
              className="w-full h-12 text-sm font-semibold bg-[var(--ngupi)] hover:bg-[var(--ngupi-light)] text-[#0a1414] border-0 rounded-xl transition-all duration-300 hover:shadow-lg hover:shadow-[var(--ngupi)]/20 hover:-translate-y-0.5 active:translate-y-0 active:shadow-none"
              disabled={isLoading}
            >
              {isLoading ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Signing in...
                </>
              ) : (
                <>
                  Sign In
                  <ArrowRight className="w-4 h-4 ml-2" />
                </>
              )}
            </Button>
          </form>
        </div>

        {/* Footer */}
        <p className="text-center text-[11px] text-muted-foreground/40 mt-6 font-light">
          Kedai Ngupi-Ngupi Purwakarta
        </p>
      </div>
    </div>
  );
}
