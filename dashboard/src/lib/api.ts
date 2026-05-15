const API_BASE =
  process.env.NEXT_PUBLIC_API_BASE || "/dashboard/api";

export interface User {
  id: number;
  username: string;
  role: string;
  name: string;
}

export interface OrderItem {
  menu_name: string;
  qty: number;
  temperature: string;
}

export interface OrderPayment {
  amount: number;
  total_payment: number;
  paid_at: string | null;
}

export interface Order {
  id: number;
  client_order_id: string;
  customer_name_snapshot: string;
  customer_phone_snapshot: string;
  fulfillment_method: "delivery" | "pickup" | "dine_in";
  payment_method: "qris" | "cod";
  payment_status: "pending" | "confirmed";
  order_status: string;
  location_lat: number | null;
  location_lng: number | null;
  delivery_provider: string | null;
  table_number?: number;
  created_at: string;
  updated_at: string;
  items: OrderItem[];
  payment: OrderPayment | null;
}

export interface OrdersMeta {
  total: number;
  page: number;
  per_page: number;
  pages: number;
}

export interface OrdersResponse {
  ok: boolean;
  data: Order[];
  meta: OrdersMeta;
}

export interface OrderStats {
  totalToday: number;
  pendingDelivery: number;
  onTheWay: number;
  completedToday: number;
  dineInToday: number;
  pickupToday: number;
  deliveryToday: number;
  revenueToday: number;
  avgOrderValue: number;
}

export interface MenuStats {
  totalItems: number;
  availableItems: number;
  unavailableItems: number;
  availabilityRate: number;
  topUnavailableCategories: { category: string; count: number }[];
  latestUnavailable: { id: string; name: string; category: string; price: number }[];
  lastSyncedAt: string | null;
}

function getToken(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem("ngupi_token");
}

export function setToken(token: string) {
  localStorage.setItem("ngupi_token", token);
}

export function removeToken() {
  localStorage.removeItem("ngupi_token");
}

export function setUser(user: User) {
  localStorage.setItem("ngupi_user", JSON.stringify(user));
}

export function getUser(): User | null {
  if (typeof window === "undefined") return null;
  const raw = localStorage.getItem("ngupi_user");
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export function removeUser() {
  localStorage.removeItem("ngupi_user");
}

async function apiFetch<T>(
  path: string,
  options: RequestInit = {}
): Promise<T> {
  const token = getToken();
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(options.headers as Record<string, string>),
  };
  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }

  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers,
  });

  if (res.status === 401) {
    removeToken();
    removeUser();
    if (typeof window !== "undefined") {
      window.location.href = "/login";
    }
    throw new Error("Unauthorized");
  }

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`API Error ${res.status}: ${body}`);
  }

  return res.json();
}

// Auth
export async function login(
  username: string,
  password: string
): Promise<{ token: string; user: User }> {
  const res = await fetch(`${API_BASE}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(body || "Login gagal");
  }
  const json = await res.json();
  return json.data || json;
}

export async function getMe(): Promise<User> {
  const res = await apiFetch<{ user?: User } & User>("/auth/me");
  return res.user || res;
}

export async function createUser(data: {
  username: string;
  password: string;
  role: string;
  name: string;
}): Promise<User> {
  return apiFetch<User>("/auth/users", {
    method: "POST",
    body: JSON.stringify(data),
  });
}

// Orders
export async function getOrders(params: {
  status?: string;
  payment_status?: string;
  fulfillment?: string;
  search?: string;
  page?: number;
  per_page?: number;
  sort?: string;
  order?: string;
}): Promise<OrdersResponse> {
  const searchParams = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== "") {
      searchParams.set(key, String(value));
    }
  });
  return apiFetch<OrdersResponse>(`/orders?${searchParams.toString()}`);
}

export async function getOrder(id: number): Promise<{ ok: boolean; data: Order }> {
  return apiFetch<{ ok: boolean; data: Order }>(`/orders/${id}`);
}

export async function updateOrderStatus(
  id: number,
  status: string,
  notes?: string
): Promise<Order> {
  return apiFetch<Order>(`/orders/${id}/status`, {
    method: "PATCH",
    body: JSON.stringify({ status, notes }),
  });
}

export async function getOrderStats(): Promise<{ ok: boolean; data: OrderStats }> {
  return apiFetch<{ ok: boolean; data: OrderStats }>("/orders/stats/summary");
}

export async function getMenuStats(): Promise<{ ok: boolean; data: MenuStats }> {
  return apiFetch<{ ok: boolean; data: MenuStats }>("/menu/stats");
}

// Users
export async function getUsers(): Promise<{ ok: boolean; data: User[] }> {
  return apiFetch<{ ok: boolean; data: User[] }>("/auth/users");
}

// SSE
export function connectOrderStream(
  onNewOrder: (order: Order) => void,
  onOrderUpdate: (order: Order) => void,
  onError?: () => void
): () => void {
  const token = getToken();
  if (!token) return () => {};

  let eventSource: EventSource | null = null;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let destroyed = false;

  function connect() {
    if (destroyed) return;
    const url = `${API_BASE}/orders/stream?token=${encodeURIComponent(token!)}`;
    eventSource = new EventSource(url);

    eventSource.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.type === "new_order") {
          onNewOrder(data.order);
        } else if (data.type === "order_update") {
          onOrderUpdate(data.order);
        }
      } catch {
        // ignore parse errors
      }
    };

    eventSource.onerror = () => {
      eventSource?.close();
      eventSource = null;
      if (onError) onError();
      if (!destroyed) {
        reconnectTimer = setTimeout(connect, 5000);
      }
    };
  }

  connect();

  return () => {
    destroyed = true;
    if (reconnectTimer) clearTimeout(reconnectTimer);
    eventSource?.close();
    eventSource = null;
  };
}
