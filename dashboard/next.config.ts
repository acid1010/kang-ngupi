import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: process.env.VERCEL ? undefined : "standalone",
  async rewrites() {
    const apiOrigin = process.env.NEXT_PUBLIC_API_ORIGIN;

    if (!apiOrigin) return [];

    return [
      {
        source: "/dashboard/api/:path*",
        destination: `${apiOrigin}/dashboard/api/:path*`,
      },
    ];
  },
};

export default nextConfig;
