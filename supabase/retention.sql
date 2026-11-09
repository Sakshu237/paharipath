-- PahariPath — repeat-customer engine (run ONCE in Supabase → SQL Editor)
-- Two small tables, both server-only (RLS on, no policies = only the
-- service-role key used by /api functions can read or write them).

-- 1. One row per lifecycle email ever sent. The primary key makes every
--    email idempotent: the same email for the same booking can never go
--    out twice, even if the daily cron runs twice.
create table if not exists public.lifecycle_emails (
  key        text primary key,             -- e.g. 'thanks:PP482913'
  kind       text not null,                -- pretrip | thanks | nextstamp | anniversary
  booking_ref text,
  email      text,
  sent_at    timestamptz not null default now()
);
create index if not exists lifecycle_emails_email_idx on public.lifecycle_emails (email, sent_at desc);
alter table public.lifecycle_emails enable row level security;

-- 2. Travellers who clicked "unsubscribe" in a reminder email.
--    Booking emails (confirmation, pre-trip details) still go out —
--    only the "come back" style reminders stop.
create table if not exists public.email_optouts (
  email      text primary key,
  created_at timestamptz not null default now()
);
alter table public.email_optouts enable row level security;

-- Make sure nobody outside the server can touch them.
revoke all on public.lifecycle_emails from anon, authenticated;
revoke all on public.email_optouts   from anon, authenticated;

-- ── Pahari Passport prizes (added later — safe to run on its own) ──
-- One row per prize a traveller unlocks. The unique key means a prize
-- can never unlock twice. Physical prizes start as 'to_send' and show
-- in Admin → Control Centre → Prizes to send until marked 'sent'.
create table if not exists public.passport_prizes (
  id               bigint generated always as identity primary key,
  phone            text not null,
  prize_key        text not null,            -- m3 | m10 | mall | region-<page>
  title            text,
  physical         boolean not null default false,
  status           text not null default 'given',   -- given | to_send | sent
  guest_name       text,
  guest_email      text,
  stamps_at_unlock int,
  created_at       timestamptz not null default now(),
  sent_at          timestamptz,
  unique (phone, prize_key)
);
alter table public.passport_prizes enable row level security;
revoke all on public.passport_prizes from anon, authenticated;
