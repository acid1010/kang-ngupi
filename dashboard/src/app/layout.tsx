import type { Metadata, Viewport } from "next";
import "./globals.css";
import { AuthProvider } from "@/lib/auth-context";
import { Toaster } from "sonner";
import { Geist } from "next/font/google";
import { cn } from "@/lib/utils";

const geist = Geist({subsets:['latin'],variable:'--font-sans'});

export const metadata: Metadata = {
  title: "Go Ngupi - Dashboard",
  description: "Coffee shop delivery management dashboard",
  icons: {
    icon: [
      { url: "/app/favicon.png", sizes: "32x32", type: "image/png" },
      { url: "/app/icon-192.png", sizes: "192x192", type: "image/png" },
    ],
    apple: "/app/apple-touch-icon.png",
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "Go Ngupi",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: "cover",
  themeColor: "#0d1b1b",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="id" className={cn("font-sans", geist.variable)}>
      <body className="min-h-screen bg-background text-foreground antialiased">
        <AuthProvider>
          {children}
          <Toaster
            position="top-right"
            theme="dark"
            richColors
            toastOptions={{
              style: {
                background: "var(--ngupi-surface)",
                border: "1px solid var(--ngupi-border)",
                color: "#f0f0f0",
              },
            }}
          />
        </AuthProvider>
      </body>
    </html>
  );
}
