-- ConfidenceWallet is restricted to the existing administrator.
-- Passwords and password hashes are managed outside version control.
create or replace function private.only_confidence_admin_auth_user()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if lower(coalesce(new.email, '')) <> 'ceo@brunnodev.store' then
    raise exception 'SIGNUP_CLOSED' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

revoke all on function private.only_confidence_admin_auth_user() from public;

create trigger confidence_admin_only_auth
before insert or update of email on auth.users
for each row execute function private.only_confidence_admin_auth_user();
