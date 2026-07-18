-- ============================================================
-- Circle — Supabase schema
-- Run this once in your Supabase project's SQL Editor
-- (Dashboard → SQL Editor → New query → paste → Run)
-- ============================================================

create extension if not exists "pgcrypto";

-- ---------- Messages (persisted chat history) ----------
create table if not exists public.messages (
  id          uuid primary key default gen_random_uuid(),
  group_name  text not null check (group_name in ('girl','boy')),
  sender_id   text not null,
  sender_name text not null,
  text        text not null check (char_length(text) between 1 and 1000),
  created_at  timestamptz not null default now()
);

create index if not exists messages_group_created_idx
  on public.messages (group_name, created_at);

alter table public.messages enable row level security;

-- Public demo policies: anyone with the anon key can read/write.
-- Fine for a small community demo. See README "Before real launch"
-- for how to tighten this once you add real accounts/auth.
create policy "messages_select_all"
  on public.messages for select
  using (true);

create policy "messages_insert_all"
  on public.messages for insert
  with check (true);

-- ---------- Realtime ----------
-- Lets clients subscribe to new rows as they're inserted.
alter publication supabase_realtime add table public.messages;

-- Presence (who's online) and call signaling do NOT need tables —
-- the app uses Supabase Realtime's built-in Presence and Broadcast
-- features for those, which are ephemeral by design.
