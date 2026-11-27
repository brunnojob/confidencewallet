create index transactions_actor_created_idx on public.transactions(actor_id,created_at desc);
create index transactions_source_idx on public.transactions(source_account);
create index transactions_destination_idx on public.transactions(destination_account);
create index ledger_entries_account_idx on public.ledger_entries(account_id);
create index fraud_alerts_actor_idx on public.fraud_alerts(actor_id);
create index fraud_alerts_transaction_idx on public.fraud_alerts(transaction_id);
alter publication supabase_realtime add table public.accounts, public.transactions;