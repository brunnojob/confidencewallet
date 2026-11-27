create extension if not exists pgcrypto with schema extensions;
create schema if not exists private;
revoke all on schema private from public, anon, authenticated;
create table public.profiles (
 id uuid primary key references auth.users(id) on delete restrict,
 email text not null,
 role text not null default 'USER' check (role in ('ADMIN','USER')),
 created_at timestamptz not null default now()
);
create unique index one_root_admin on public.profiles(role) where role='ADMIN';
create table public.accounts (
 id uuid primary key default gen_random_uuid(),
 owner_id uuid not null references public.profiles(id),
 currency text not null check (currency in ('BRL','USD','EUR')),
 balance numeric(24,4) not null default 0 check (balance >= 0),
 created_at timestamptz not null default now(),
 unique(owner_id,currency)
);
create table public.transactions (
 id uuid primary key default gen_random_uuid(),
 idempotency_key uuid not null unique,
 actor_id uuid not null references public.profiles(id),
 source_account uuid not null references public.accounts(id),
 destination_account uuid not null references public.accounts(id),
 amount numeric(24,4) not null check (amount > 0),
 currency text not null,
 created_at timestamptz not null default now(),
 check (source_account <> destination_account)
);
create table public.ledger_entries (
 id bigint generated always as identity primary key,
 transaction_id uuid not null references public.transactions(id),
 account_id uuid not null references public.accounts(id),
 delta numeric(24,4) not null check (delta <> 0),
 created_at timestamptz not null default now(),
 unique(transaction_id,account_id)
);
create table public.audit_chain (
 seq bigint generated always as identity primary key,
 transaction_id uuid not null unique references public.transactions(id),
 prev_hash text not null check (prev_hash ~ '^[a-f0-9]{64}$'),
 payload_hash text not null check (payload_hash ~ '^[a-f0-9]{64}$'),
 hmac_signature text not null check (hmac_signature ~ '^[a-f0-9]{64}$'),
 created_at timestamptz not null default now()
);
create table public.fraud_alerts (
 id bigint generated always as identity primary key,
 actor_id uuid not null references public.profiles(id),
 transaction_id uuid references public.transactions(id),
 reason text not null,
 created_at timestamptz not null default now()
);
create function private.new_user() returns trigger language plpgsql security definer set search_path='' as $$
declare selected_role text;
begin
 perform pg_advisory_xact_lock(458217,1);
 if not exists (select 1 from public.profiles where role='ADMIN') then selected_role := 'ADMIN'; else selected_role := 'USER'; end if;
 insert into public.profiles(id,email,role) values (new.id,coalesce(new.email,''),selected_role);
 insert into public.accounts(owner_id,currency) values (new.id,'BRL'),(new.id,'USD'),(new.id,'EUR');
 return new;
end $$;
create trigger on_confidence_user_created after insert on auth.users for each row execute function private.new_user();
create function private.immutable_row() returns trigger language plpgsql set search_path='' as $$
begin raise exception 'IMMUTABLE_LEDGER_VIOLATION'; end $$;
create trigger immutable_entries before update or delete on public.ledger_entries for each row execute function private.immutable_row();
create trigger immutable_transactions before update or delete on public.transactions for each row execute function private.immutable_row();
create trigger immutable_audit before update or delete on public.audit_chain for each row execute function private.immutable_row();
create function private.guard_balance() returns trigger language plpgsql set search_path='' as $$
begin
 if old.balance is distinct from new.balance and current_setting('app.transfer_guard',true) is distinct from 'on' then
 raise exception 'BALANCE_UPDATE_FORBIDDEN';
 end if;
 if old.owner_id is distinct from new.owner_id or old.currency is distinct from new.currency then raise exception 'ACCOUNT_IDENTITY_IMMUTABLE'; end if;
 return new;
end $$;
create trigger guard_account_balance before update on public.accounts for each row execute function private.guard_balance();
create function private.execute_double_entry_transfer(p_actor uuid,p_source uuid,p_destination uuid,p_amount numeric,p_key uuid,p_prev_hash text,p_payload_hash text,p_signature text)
returns uuid language plpgsql security definer set search_path='' as $$
declare src public.accounts%rowtype; dst public.accounts%rowtype; existing public.transactions%rowtype; prior text; txid uuid := gen_random_uuid(); canonical text; actual_hash text;
begin
 if current_user <> 'postgres' then raise exception 'BACKEND_ONLY'; end if;
 if current_setting('app.actor_id',true) is distinct from p_actor::text then raise exception 'ACTOR_MISMATCH'; end if;
 if p_amount is null or p_amount <= 0 or p_amount <> round(p_amount,4) or p_source = p_destination or p_key is null then raise exception 'INVALID_TRANSFER'; end if;
 perform pg_advisory_xact_lock(458217,2);
 select * into existing from public.transactions where idempotency_key=p_key;
 if found then
  if existing.actor_id=p_actor and existing.source_account=p_source and existing.destination_account=p_destination and existing.amount=p_amount then return existing.id; end if;
  raise exception 'IDEMPOTENCY_CONFLICT';
 end if;
 perform 1 from public.accounts where id in (p_source,p_destination) order by id for update;
 select * into src from public.accounts where id=p_source;
 select * into dst from public.accounts where id=p_destination;
 if src.id is null or dst.id is null then raise exception 'ACCOUNT_NOT_FOUND'; end if;
 if src.owner_id <> p_actor or src.currency <> dst.currency or src.balance < p_amount then raise exception 'TRANSFER_DENIED'; end if;
 select coalesce((select encode(extensions.digest(prev_hash || payload_hash || hmac_signature,'sha256'),'hex') from public.audit_chain order by seq desc limit 1),repeat('0',64)) into prior;
 if p_prev_hash is distinct from prior then raise exception 'STALE_AUDIT_HEAD'; end if;
 canonical := p_key::text || '|' || p_actor::text || '|' || p_source::text || '|' || p_destination::text || '|' || trim(to_char(p_amount,'FM99999999999999999990.0000')) || '|' || src.currency || '|' || prior;
 actual_hash := encode(extensions.digest(convert_to(canonical,'UTF8'),'sha256'),'hex');
 if actual_hash <> p_payload_hash or p_signature !~ '^[a-f0-9]{64}$' then raise exception 'INVALID_AUDIT_PAYLOAD'; end if;
 insert into public.transactions(id,idempotency_key,actor_id,source_account,destination_account,amount,currency)
 values(txid,p_key,p_actor,p_source,p_destination,p_amount,src.currency);
 perform set_config('app.transfer_guard','on',true);
 update public.accounts set balance=balance-p_amount where id=p_source;
 update public.accounts set balance=balance+p_amount where id=p_destination;
 perform set_config('app.transfer_guard','off',true);
 insert into public.ledger_entries(transaction_id,account_id,delta) values(txid,p_source,-p_amount),(txid,p_destination,p_amount);
 insert into public.audit_chain(transaction_id,prev_hash,payload_hash,hmac_signature) values(txid,prior,p_payload_hash,p_signature);
 return txid;
end $$;
revoke all on function private.execute_double_entry_transfer(uuid,uuid,uuid,numeric,uuid,text,text,text) from public,anon,authenticated;
revoke all on public.profiles,public.accounts,public.transactions,public.ledger_entries,public.audit_chain,public.fraud_alerts from anon,authenticated;
grant usage on schema public to authenticated;
grant select on public.profiles,public.accounts,public.transactions,public.ledger_entries,public.audit_chain,public.fraud_alerts to authenticated;
alter table public.profiles enable row level security;
alter table public.accounts enable row level security;
alter table public.transactions enable row level security;
alter table public.ledger_entries enable row level security;
alter table public.audit_chain enable row level security;
alter table public.fraud_alerts enable row level security;
create function private.is_admin() returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.profiles where id=(select auth.uid()) and role='ADMIN') $$;
revoke all on function private.is_admin() from public,anon;
grant usage on schema private to authenticated;
grant execute on function private.is_admin() to authenticated;
create policy profile_read on public.profiles for select to authenticated using (id=(select auth.uid()) or (select private.is_admin()));
create policy account_read on public.accounts for select to authenticated using (owner_id=(select auth.uid()) or (select private.is_admin()));
create policy transaction_read on public.transactions for select to authenticated using (
 actor_id=(select auth.uid()) or exists(select 1 from public.accounts a where (a.id=source_account or a.id=destination_account) and a.owner_id=(select auth.uid())) or (select private.is_admin()));
create policy entry_read on public.ledger_entries for select to authenticated using (
 exists(select 1 from public.accounts a where a.id=account_id and a.owner_id=(select auth.uid())) or (select private.is_admin()));
create policy audit_read on public.audit_chain for select to authenticated using ((select private.is_admin()));
create policy alert_read on public.fraud_alerts for select to authenticated using (actor_id=(select auth.uid()) or (select private.is_admin()));
create view public.admin_audit with (security_invoker=true) as
 select c.seq,c.created_at,c.prev_hash,c.payload_hash,c.hmac_signature,t.id as transaction_id,t.actor_id,t.amount,t.currency
 from public.audit_chain c join public.transactions t on t.id=c.transaction_id
 where (select private.is_admin());
grant select on public.admin_audit to authenticated;
