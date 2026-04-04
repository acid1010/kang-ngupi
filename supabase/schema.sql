create table if not exists customers (
  id uuid primary key default gen_random_uuid(),
  name text,
  phone text not null unique,
  display_name text,
  preferred_salutation text check (preferred_salutation in ('kak', 'name', 'flexible')),
  preferred_tone text check (preferred_tone in ('casual', 'warm', 'playful_light', 'neutral')),
  communication_notes text,
  last_seen_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists orders (
  id uuid primary key default gen_random_uuid(),
  client_order_id text not null unique,
  customer_id uuid references customers(id) on delete set null,
  customer_name_snapshot text,
  customer_phone_snapshot text,
  channel text not null default 'whatsapp',
  raw_message text,
  fulfillment_method text check (fulfillment_method in ('self_pickup', 'delivery')),
  payment_method text check (payment_method in ('cod', 'qris', 'transfer')),
  payment_status text not null default 'pending' check (payment_status in ('pending', 'confirmed', 'failed')),
  order_status text not null default 'draft' check (order_status in ('draft', 'awaiting_payment', 'ready_to_submit', 'submitted', 'cancelled')),
  location_status text,
  location_lat double precision,
  location_lng double precision,
  location_label text,
  delivery_provider text check (delivery_provider in ('ngupi_express', 'grab', 'gojek')),
  notes jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references orders(id) on delete cascade,
  menu_id text,
  menu_name text not null,
  qty integer not null check (qty > 0),
  temperature text check (temperature in ('hot', 'iced')),
  notes text,
  created_at timestamptz not null default now()
);

create table if not exists order_payments (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references orders(id) on delete cascade,
  client_order_id text not null unique,
  provider text not null default 'pakasir',
  provider_project text not null,
  provider_order_id text not null unique,
  amount integer not null check (amount > 0),
  fee integer,
  total_payment integer not null check (total_payment > 0),
  currency text not null default 'IDR',
  payment_method text not null default 'qris' check (payment_method in ('qris')),
  provider_status text not null default 'pending',
  payment_status text not null default 'pending' check (payment_status in ('pending', 'confirmed', 'failed')),
  qr_string text,
  expired_at timestamptz,
  paid_at timestamptz,
  customer_phone_snapshot text,
  customer_name_snapshot text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_customers_phone on customers(phone);
create index if not exists idx_orders_customer_id on orders(customer_id);
create index if not exists idx_orders_order_status on orders(order_status);
create index if not exists idx_orders_created_at on orders(created_at desc);
create index if not exists idx_order_items_order_id on order_items(order_id);
create index if not exists idx_order_payments_order_id on order_payments(order_id);
create index if not exists idx_order_payments_provider_status on order_payments(provider_status);
