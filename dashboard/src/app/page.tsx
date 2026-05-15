import Link from "next/link";
import { ArrowRight, Bot, CreditCard, MapPin, MessageCircle, Truck } from "lucide-react";

const capabilities = [
  {
    title: "WhatsApp ordering",
    description: "Customers order through natural language chat without installing another app.",
    icon: MessageCircle,
  },
  {
    title: "Delivery operations",
    description: "Courier-ready workflow with location handoff, status updates, and completion tracking.",
    icon: Truck,
  },
  {
    title: "QRIS payments",
    description: "Doku QRIS generation and payment verification are connected to the order flow.",
    icon: CreditCard,
  },
];

export default function LandingPage() {
  return (
    <main className="min-h-screen w-full max-w-full overflow-x-hidden bg-background text-foreground">
      <nav className="fixed left-1/2 top-5 z-50 flex w-[calc(100%-2rem)] max-w-5xl -translate-x-1/2 items-center justify-between rounded-full border border-border/50 bg-background/75 px-4 py-3 backdrop-blur-2xl sm:px-5">
        <Link href="/" className="flex items-center gap-2.5">
          <span className="h-8 w-8 overflow-hidden rounded-xl ring-1 ring-border/60">
            <img src="/logo.jpg" alt="Go Ngupi" className="h-full w-full object-cover" />
          </span>
          <span className="text-sm font-bold tracking-tight text-[var(--ngupi)]">Kang Ngupi</span>
        </Link>

        <div className="flex items-center gap-2">
          <Link
            href="/kurir"
            className="hidden rounded-full px-3 py-2 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground sm:inline-flex"
          >
            Courier
          </Link>
          <Link
            href="/login"
            className="rounded-full bg-[var(--ngupi)] px-4 py-2 text-xs font-semibold text-[#071313] transition-all hover:bg-[var(--ngupi-light)]"
          >
            Dashboard
          </Link>
        </div>
      </nav>

      <section className="relative flex min-h-screen items-center justify-center px-5 pb-20 pt-32 text-center">
        <div className="pointer-events-none absolute left-1/2 top-0 h-[680px] w-[680px] -translate-x-1/2 rounded-full bg-[var(--ngupi)]/[0.05] blur-[120px]" />
        <div className="relative mx-auto max-w-6xl">
          <div className="mb-7 inline-flex items-center gap-2 rounded-full border border-[var(--ngupi)]/20 bg-[var(--ngupi)]/8 px-4 py-2 text-xs font-medium text-[var(--ngupi)]">
            <Bot className="h-3.5 w-3.5" />
            Production AI ordering assistant
          </div>
          <h1 className="mx-auto max-w-6xl text-[clamp(3rem,7vw,6.25rem)] font-black leading-[0.98] tracking-[-0.065em] text-foreground">
            Coffee orders, handled by conversational AI.
          </h1>
          <p className="mx-auto mt-7 max-w-2xl text-base font-light leading-7 text-muted-foreground sm:text-lg">
            Kang Ngupi runs WhatsApp ordering for Kedai Ngupi-Ngupi Purwakarta: natural language order capture, delivery fee calculation, QRIS payments, and courier operations.
          </p>
          <div className="mt-9 flex flex-col items-center justify-center gap-3 sm:flex-row">
            <a
              href="https://wa.me/6287786434813?text=Hi%20Kang%20Ngupi%2C%20I%27d%20like%20to%20order!"
              className="inline-flex h-12 items-center justify-center rounded-full bg-[var(--ngupi)] px-6 text-sm font-semibold text-[#071313] transition-all hover:-translate-y-0.5 hover:bg-[var(--ngupi-light)]"
            >
              Try on WhatsApp
              <ArrowRight className="ml-2 h-4 w-4" />
            </a>
            <Link
              href="/kurir"
              className="inline-flex h-12 items-center justify-center rounded-full border border-border/60 px-6 text-sm font-medium text-[var(--ngupi)] transition-colors hover:border-[var(--ngupi)]/50 hover:bg-[var(--ngupi)]/5"
            >
              Open Courier View
            </Link>
          </div>
        </div>
      </section>

      <section className="px-5 py-24 sm:py-32">
        <div className="mx-auto grid max-w-6xl grid-cols-1 gap-4 md:grid-cols-3">
          {capabilities.map((item) => {
            const Icon = item.icon;
            return (
              <article key={item.title} className="group rounded-3xl border border-border/40 bg-card/45 p-6 transition-all duration-300 hover:-translate-y-1 hover:border-[var(--ngupi)]/25">
                <div className="mb-5 inline-flex rounded-2xl bg-[var(--ngupi)]/8 p-3 ring-1 ring-[var(--ngupi)]/15 transition-transform duration-500 group-hover:scale-105">
                  <Icon className="h-5 w-5 text-[var(--ngupi)]" />
                </div>
                <h2 className="text-lg font-bold tracking-tight text-foreground">{item.title}</h2>
                <p className="mt-2 text-sm font-light leading-6 text-muted-foreground">{item.description}</p>
              </article>
            );
          })}
        </div>
      </section>

      <section className="px-5 py-24 sm:py-32">
        <div className="mx-auto grid max-w-6xl gap-4 lg:grid-cols-[1.1fr_0.9fr]">
          <div className="rounded-3xl border border-border/40 bg-card/45 p-7 sm:p-10">
            <h2 className="max-w-3xl text-3xl font-black tracking-[-0.04em] text-foreground sm:text-5xl">
              Built for real shop operations, not a prototype.
            </h2>
            <p className="mt-5 max-w-2xl text-sm font-light leading-7 text-muted-foreground sm:text-base">
              The system connects an LLM agent runtime, WhatsApp, Supabase, Doku QRIS, Pawoon POS, and a courier dashboard. The Vercel frontend talks to the existing VPS backend while operational workers stay stateful on the server.
            </p>
          </div>

          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-1">
            <div className="rounded-3xl border border-border/40 bg-card/45 p-7">
              <p className="font-mono text-4xl font-black tracking-tight text-[var(--ngupi)]">130+</p>
              <p className="mt-2 text-xs uppercase tracking-[0.18em] text-muted-foreground">Menu items</p>
            </div>
            <div className="rounded-3xl border border-border/40 bg-card/45 p-7">
              <p className="font-mono text-4xl font-black tracking-tight text-[var(--ngupi)]">24/7</p>
              <p className="mt-2 text-xs uppercase tracking-[0.18em] text-muted-foreground">Autonomous ordering</p>
            </div>
          </div>
        </div>
      </section>

      <footer className="border-t border-border/40 px-5 py-8">
        <div className="mx-auto flex max-w-6xl flex-col gap-3 text-xs text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
          <p>Kedai Ngupi-Ngupi, Jl. KK Singawinata No.9, Purwakarta 41114</p>
          <div className="flex gap-4">
            <a href="https://github.com/acid1010/kang-ngupi" className="hover:text-[var(--ngupi)]">GitHub</a>
            <a href="https://instagram.com/kedaingupingupi" className="hover:text-[var(--ngupi)]">Instagram</a>
            <a href="https://wa.me/6287786434813" className="hover:text-[var(--ngupi)]">WhatsApp</a>
          </div>
        </div>
      </footer>
    </main>
  );
}
