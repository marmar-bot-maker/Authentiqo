-- Authentiqo database schema (Postgres, for Supabase)
--
-- HOW TO RUN THIS: go to your Supabase project -> SQL Editor -> New query,
-- paste this entire file in, and click "Run". It only needs to be run once.

-- Repair companies (repairmen authenticate as a company)
create table if not exists repair_companies (
  id bigint generated always as identity primary key,
  company_email text unique not null,
  username text not null,
  password_hash text not null,
  company_name text not null,
  registered_shop boolean not null default false, -- true = verified/registered repair shop
  created_at timestamptz not null default now()
);

-- Sellers
create table if not exists sellers (
  id bigint generated always as identity primary key,
  email text unique not null,
  password_hash text not null,
  display_name text not null,
  created_at timestamptz not null default now()
);

-- Devices (the product passport itself)
create table if not exists devices (
  id bigint generated always as identity primary key,
  serial_number text unique not null,
  device_type text,
  brand text,
  model text,
  manufactured_date text,
  registered_by_seller_id bigint references sellers(id),
  ownership_transfer_count integer not null default 1, -- starts at 1 (first owner)
  created_at timestamptz not null default now()
);

-- Repair log entries (immutable once written)
create table if not exists repair_logs (
  id bigint generated always as identity primary key,
  serial_number text not null references devices(serial_number),
  repair_company_id bigint not null references repair_companies(id),
  description text not null,
  location text not null,
  repair_date text not null,
  verification_status text not null check (verification_status in ('verified', 'self_reported')),
  created_at timestamptz not null default now()
);

-- Ownership transfer events (count only, no personal owner data stored)
create table if not exists ownership_events (
  id bigint generated always as identity primary key,
  serial_number text not null references devices(serial_number),
  transferred_at timestamptz not null default now(),
  new_owner_number integer not null,
  source text not null default 'platform_transfer' check (source in ('platform_transfer', 'seller_declared'))
);

create index if not exists idx_repair_logs_serial on repair_logs(serial_number);
create index if not exists idx_ownership_events_serial on ownership_events(serial_number);
create index if not exists idx_devices_serial on devices(serial_number);

-- ============================================================
-- NEW TABLES — added for Parts Authenticity, Warranty Tracking,
-- and Repair Quality Rating. Safe to run again (IF NOT EXISTS).
-- If you already ran the original schema.sql in Supabase, just
-- run THIS block on its own in the SQL Editor — you don't need
-- to re-run the whole file.
-- ============================================================

create table if not exists device_parts (
  id bigint generated always as identity primary key,
  serial_number text not null references devices(serial_number),
  part_name text not null,
  authenticity_status text not null check (authenticity_status in ('genuine', 'aftermarket', 'unknown')),
  logged_by_repair_company_id bigint references repair_companies(id),
  logged_at timestamptz not null default now()
);

create table if not exists warranties (
  id bigint generated always as identity primary key,
  serial_number text not null references devices(serial_number),
  warranty_type text not null check (warranty_type in ('manufacturer', 'repair_shop', 'extended')),
  status text not null check (status in ('active', 'expired')),
  coverage_description text,
  start_date date,
  end_date date,
  issued_by_repair_company_id bigint references repair_companies(id),
  created_at timestamptz not null default now()
);

create table if not exists repair_ratings (
  id bigint generated always as identity primary key,
  repair_log_id bigint not null references repair_logs(id),
  rated_by_seller_id bigint not null references sellers(id),
  stars integer not null check (stars between 1 and 5),
  created_at timestamptz not null default now()
);

-- Optional shop location, used on the new Repair Shop Profile page
alter table repair_companies add column if not exists city text;

-- Distinguishes a platform-verified transfer (someone re-registered the device
-- under their own account) from a seller's manual declaration of prior owners
-- who never used Authentiqo. Existing rows default to 'platform_transfer'
-- since that's what every ownership_events row up to now represents.
alter table ownership_events add column if not exists source text not null default 'platform_transfer';
alter table ownership_events drop constraint if exists ownership_events_source_check;
alter table ownership_events add constraint ownership_events_source_check check (source in ('platform_transfer', 'seller_declared'));

create index if not exists idx_device_parts_serial on device_parts(serial_number);
create index if not exists idx_warranties_serial on warranties(serial_number);
create index if not exists idx_repair_ratings_log on repair_ratings(repair_log_id);

-- ============================================================
-- Supports "give up ownership" — a buyer who claims a device but never plans
-- to resell it can release it from their account without needing a separate
-- buyer account type. Distinguishes "this device has never had a real owner"
-- from "it had an owner who released it," so a later reclaim by someone new
-- correctly counts as a real ownership transfer instead of being missed.
-- ============================================================
alter table devices add column if not exists has_been_claimed boolean not null default false;
update devices set has_been_claimed = true where registered_by_seller_id is not null;
