create table public.products (
  id uuid primary key default gen_random_uuid(),
  seller_id uuid not null references public.profiles(id),
  title text not null check (length(title) between 3 and 120),
  price_cents bigint not null check (price_cents between 100 and 100000000),
  active boolean not null default true,
  created_at timestamptz not null default now()
);
create table public.checkout_orders (
  id uuid primary key,
  product_id uuid not null references public.products(id),
  seller_id uuid not null references public.profiles(id),
  amount_cents bigint not null check (amount_cents > 0),
  idempotency_key uuid not null unique,
  status text not null default 'created' check (status in ('created','pending','approved','rejected','cancelled','refunded','charged_back')),
  mp_preference_id text unique,
  mp_payment_id text unique,
  checkout_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table public.payment_events (
  id bigint generated always as identity primary key,
  order_id uuid not null references public.checkout_orders(id),
  mp_payment_id text not null,
  status text not null,
  amount_cents bigint not null,
  received_at timestamptz not null default now(),
  unique(mp_payment_id,status)
);
create index checkout_orders_seller_created on public.checkout_orders(seller_id,created_at desc);
create index checkout_orders_product on public.checkout_orders(product_id);
alter table public.products enable row level security;
alter table public.checkout_orders enable row level security;
alter table public.payment_events enable row level security;
revoke all on public.products,public.checkout_orders,public.payment_events from public,anon,authenticated;
grant select on public.products to anon,authenticated;
grant insert,update on public.products to authenticated;
grant select on public.checkout_orders,public.payment_events to authenticated;
create policy product_catalog on public.products for select to anon,authenticated
  using (active or seller_id=(select auth.uid()));
create policy admin_create_product on public.products for insert to authenticated
  with check (seller_id=(select auth.uid()) and (select private.is_admin()));
create policy admin_update_product on public.products for update to authenticated
  using (seller_id=(select auth.uid()) and (select private.is_admin()))
  with check (seller_id=(select auth.uid()) and (select private.is_admin()));
create policy admin_read_order on public.checkout_orders for select to authenticated
  using (seller_id=(select auth.uid()) and (select private.is_admin()));
create policy admin_read_payment_event on public.payment_events for select to authenticated
  using (exists(select 1 from public.checkout_orders o where o.id=order_id and o.seller_id=(select auth.uid()) and (select private.is_admin())));

create function public.record_mp_payment(p_order uuid,p_payment text,p_status text,p_amount_cents bigint)
returns void language plpgsql security invoker set search_path='' as $$
declare o public.checkout_orders%rowtype; target text;
begin
  if current_user <> 'service_role' then raise exception 'BACKEND_ONLY'; end if;
  if p_payment !~ '^[0-9]{1,20}$' or p_status not in ('approved','pending','in_process','rejected','cancelled','refunded','charged_back') then
    raise exception 'INVALID_PAYMENT';
  end if;
  select * into o from public.checkout_orders where id=p_order for update;
  if not found or o.mp_preference_id is null or o.amount_cents <> p_amount_cents then raise exception 'PAYMENT_MISMATCH'; end if;
  target := case when p_status='in_process' then 'pending' else p_status end;
  insert into public.payment_events(order_id,mp_payment_id,status,amount_cents)
    values(p_order,p_payment,p_status,p_amount_cents) on conflict(mp_payment_id,status) do nothing;
  if o.status in ('refunded','charged_back') then return; end if;
  if o.status='approved' and target not in ('refunded','charged_back') then return; end if;
  if target in ('refunded','charged_back') and o.status <> 'approved' then return; end if;
  update public.checkout_orders set status=target,mp_payment_id=p_payment,updated_at=now() where id=p_order;
end $$;
revoke all on function public.record_mp_payment(uuid,text,text,bigint) from public,anon,authenticated;
grant execute on function public.record_mp_payment(uuid,text,text,bigint) to service_role;
