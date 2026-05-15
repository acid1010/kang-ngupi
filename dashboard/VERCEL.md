# Vercel Migration Notes

This repository is now prepared to run as the public frontend on Vercel.

## Routes

- `/` - public Kang Ngupi landing page
- `/login` - dashboard login
- `/dashboard` - admin dashboard
- `/dashboard/orders` - admin order management
- `/dashboard/users` - admin user management
- `/kurir` - courier delivery operations
- `/app`, `/app/login`, `/app/kurir` - legacy redirects for old VPS links

## Environment Variables

Set these in Vercel:

```bash
NEXT_PUBLIC_API_BASE=https://api.ngupingupi.me/dashboard/api
NEXT_PUBLIC_API_ORIGIN=https://api.ngupingupi.me
```

If `NEXT_PUBLIC_API_BASE` is omitted, the frontend calls `/dashboard/api` on the same domain. Use this only when Vercel rewrites `/dashboard/api/*` to the VPS backend.

## Backend Still Runs on VPS

Keep these services on the VPS:

- Express API and webhooks
- WhatsApp/OpenClaw runtime
- Doku QRIS poller
- Internal schedulers
- Server-sent events for live order updates

## DNS Recommendation

Use Vercel for the main domain and keep the VPS backend on a subdomain:

```txt
ngupingupi.me       -> Vercel
www.ngupingupi.me   -> Vercel
api.ngupingupi.me   -> VPS reverse proxy
```

The API subdomain should proxy to the existing backend service on port `3001`.
