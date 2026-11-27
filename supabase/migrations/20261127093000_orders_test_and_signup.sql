-- Allow new buyers and seller applicants while preserving the single root administrator.
drop trigger if exists confidence_admin_only_auth on auth.users;
drop function if exists private.only_confidence_admin_auth_user();
alter table public.profiles add column account_type text not null default 'BUYER'
  check (account_type in ('BUYER','SELLER'));
alter table public.profiles add column seller_status text not null default 'NONE'
  check (seller_status in ('NONE','PENDING','APPROVED'));
create or replace function private.new_user() returns trigger language plpgsql security definer set search_path='' as $$
declare selected_role text := 'USER'; selected_type text := 'BUYER';
begin
  perform pg_advisory_xact_lock(458217,1);
  if lower(coalesce(new.email,''))='ceo@brunnodev.store' and not exists(select 1 from public.profiles where role='ADMIN') then
    selected_role := 'ADMIN';
  end if;
  if new.raw_user_meta_data->>'account_type'='SELLER' then selected_type := 'SELLER'; end if;
  insert into public.profiles(id,email,role,account_type,seller_status)
    values(new.id,coalesce(new.email,''),selected_role,selected_type,case when selected_type='SELLER' then 'PENDING' else 'NONE' end);
  insert into public.accounts(owner_id,currency) values (new.id,'BRL'),(new.id,'USD'),(new.id,'EUR');
  return new;
end $$;
-- Only the checkout worker can modify order state; app users see their own profile.
alter table public.checkout_orders add column mp_order_id text unique;
drop function if exists public.record_mp_payment(uuid,text,text,bigint);
create function public.record_mp_order(p_order uuid,p_provider_order text,p_status text,p_amount_cents bigint)
returns void language plpgsql security invoker set search_path='' as $$
declare o public.checkout_orders%rowtype;
begin
  if current_user <> 'service_role' then raise exception 'BACKEND_ONLY'; end if;
  if p_provider_order !~* '^ORD[A-Z0-9]{10,64}$' or p_status not in ('approved','pending','rejected','cancelled') then
    raise exception 'INVALID_ORDER';
  end if;
  select * into o from public.checkout_orders where id=p_order for update;
  if not found or o.mp_order_id is distinct from p_provider_order or o.amount_cents <> p_amount_cents then
    raise exception 'ORDER_MISMATCH';
  end if;
  insert into public.payment_events(order_id,mp_payment_id,status,amount_cents)
    values(p_order,p_provider_order,p_status,p_amount_cents)
    on conflict(mp_payment_id,status) do nothing;
  if o.status in ('approved','refunded','charged_back') then return; end if;
  update public.checkout_orders set status=p_status,mp_payment_id=p_provider_order,updated_at=now() where id=p_order;
end $$;
revoke all on function public.record_mp_order(uuid,text,text,bigint) from public,anon,authenticated;
grant execute on function public.record_mp_order(uuid,text,text,bigint) to service_role;
