-- Run in Supabase SQL Editor. Simple anonymous SMS: send, track status, receive replies.
alter table public.profiles add column if not exists can_send boolean not null default false;
update public.profiles set can_send = true where role = 'admin';

drop policy if exists "profile update own" on public.profiles;
create policy "profile update own" on public.profiles for update
  using (id = auth.uid())
  with check (id = auth.uid()
    and role = (select p.role from public.profiles p where p.id = auth.uid())
    and can_send = (select p.can_send from public.profiles p where p.id = auth.uid()));
create policy "profile admin update" on public.profiles for update
  using (public.is_admin()) with check (public.is_admin());

create table if not exists public.sms_messages (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  direction text not null check (direction in ('out','in')),
  to_phone text not null,            -- the recipient's number (as typed by the sender)
  body text not null,
  status text not null default 'queued',
  twilio_sid text unique,
  error text,
  created_at timestamptz not null default now()
);
create index if not exists sms_user_idx on public.sms_messages (user_id, created_at);
create index if not exists sms_phone_idx on public.sms_messages (to_phone, created_at desc);
alter table public.sms_messages enable row level security;
create policy "sms own read" on public.sms_messages for select using (user_id = auth.uid());
grant select on public.sms_messages to authenticated;
alter publication supabase_realtime add table public.sms_messages;
