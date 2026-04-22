"use client";

import { useState, FormEvent, useEffect } from "react";
import { useRouter } from "next/navigation";
import { login } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Eye, EyeOff, Loader2, Coffee } from "lucide-react";

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
      router.replace("/dashboard");
    }
  }, [user, loading, router]);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError("");
    setIsLoading(true);

    try {
      const res = await login(username, password);
      loginSuccess(res.token, res.user);
      router.push("/dashboard");
    } catch {
      setError("Username atau password salah");
    } finally {
      setIsLoading(false);
    }
  }

  if (loading) return null;

  return (
    <div className="min-h-screen flex items-center justify-center p-4 bg-background relative overflow-hidden">
      {/* Background decoration */}
      <div className="absolute inset-0 pointer-events-none">
        <div className="absolute -top-32 -right-32 w-72 h-72 bg-[var(--ngupi)]/5 rounded-full blur-3xl" />
        <div className="absolute -bottom-32 -left-32 w-72 h-72 bg-[var(--ngupi-darker)]/5 rounded-full blur-3xl" />
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] bg-[var(--ngupi)]/[0.02] rounded-full blur-3xl" />
      </div>

      <Card className="w-full max-w-sm relative border-border/60 bg-card/95 backdrop-blur-xl shadow-2xl shadow-black/20">
        <CardHeader className="text-center pb-2 pt-8">
          {/* Logo */}
          <div className="mx-auto mb-5 w-20 h-20 rounded-2xl overflow-hidden shadow-lg shadow-black/30 ring-1 ring-border">
            <img
              src="/app/logo.jpg"
              alt="Ngupi Ngupi"
              className="w-full h-full object-cover"
            />
          </div>

          <CardTitle className="text-xl font-bold text-[var(--ngupi)]">
            Go Ngupi
          </CardTitle>
          <CardDescription className="text-muted-foreground text-xs mt-1">
            Dashboard Kedai Kopi Ngupi Ngupi
          </CardDescription>
        </CardHeader>

        <Separator className="bg-border/50 mx-6" />

        <CardContent className="pt-5 pb-7 px-6">
          <form onSubmit={handleSubmit} className="space-y-4">
            {/* Error message */}
            {error && (
              <div className="p-3 rounded-lg bg-red-500/8 border border-red-500/15 text-red-400 text-sm text-center">
                {error}
              </div>
            )}

            {/* Username */}
            <div className="space-y-2">
              <label className="text-sm font-medium text-foreground/80">
                Username
              </label>
              <Input
                type="text"
                placeholder="Masukkan username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                required
                autoComplete="username"
                autoFocus
                className="h-11 bg-secondary/50 border-border/60 placeholder:text-muted-foreground/40 focus:border-[var(--ngupi)]/50 focus:ring-[var(--ngupi)]/20"
              />
            </div>

            {/* Password */}
            <div className="space-y-2">
              <label className="text-sm font-medium text-foreground/80">
                Password
              </label>
              <div className="relative">
                <Input
                  type={showPassword ? "text" : "password"}
                  placeholder="Masukkan password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  autoComplete="current-password"
                  className="h-11 pr-10 bg-secondary/50 border-border/60 placeholder:text-muted-foreground/40 focus:border-[var(--ngupi)]/50 focus:ring-[var(--ngupi)]/20"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground/80 transition-colors"
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
              size="lg"
              className="w-full h-11 text-sm font-semibold bg-[var(--ngupi-darker)] hover:bg-[var(--ngupi-dark)] text-white border-0"
              disabled={isLoading}
            >
              {isLoading ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Masuk...
                </>
              ) : (
                <>
                  <Coffee className="w-4 h-4 mr-2" />
                  Masuk
                </>
              )}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
