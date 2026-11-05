-- ============================================================
-- PERRY 014 — Licenze desktop (condivise tra app e sito)
-- ============================================================
-- Stesso progetto Supabase dell'app: auth e profili sono già qui.
-- Le chiavi in chiaro non entrano mai nel database:
--   key_hash       = HMAC-SHA256(chiave, pepper)        -> usato per cercare
--   key_ciphertext = AES-256-GCM(chiave, master key)    -> usato per mostrarla
-- Entrambi i segreti vivono solo nei secret delle Edge Functions.
--
-- Le tabelle sono chiuse: anon e authenticated non hanno alcun grant.
-- Tutto passa da service_role nelle Edge Functions.
-- ============================================================

create table if not exists public.licenses (
  id                    uuid primary key default gen_random_uuid(),
  user_id               uuid references auth.users(id) on delete set null,
  plan                  text not null check (plan in ('monthly', 'annual', 'lifetime')),
  status                text not null default 'active'
                          check (status in ('active', 'past_due', 'canceled', 'expired', 'revoked', 'pending')),
  source                text not null default 'manual'
                          check (source in ('stripe', 'lifetime', 'admin', 'manual')),
  key_hash              text unique,
  key_hint              text not null,
  key_ciphertext        text,
  max_seats             smallint not null default 2 check (max_seats between 1 and 10),
  issued_at             timestamptz not null default now(),
  claimed_at            timestamptz,
  expires_at            timestamptz,
  stripe_customer_id    text,
  stripe_subscription_id text unique,
  stripe_price_id       text,
  current_period_end    timestamptz,
  cancel_at_period_end  boolean not null default false,
  last_seen_at          timestamptz,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  constraint licenses_lifetime_forever check (plan <> 'lifetime' or expires_at is null),
  -- Solo le lifetime possono essere pre-generate e non ancora assegnate.
  constraint licenses_unbound_is_lifetime check (user_id is not null or plan = 'lifetime')
);

-- Un solo titolo per account: rinnovi e upgrade aggiornano la stessa riga.
create unique index if not exists licenses_one_per_user
  on public.licenses (user_id)
  where user_id is not null;

create index if not exists licenses_customer_idx
  on public.licenses (stripe_customer_id)
  where stripe_customer_id is not null;

drop trigger if exists licenses_touch_updated_at on public.licenses;
create trigger licenses_touch_updated_at
  before update on public.licenses
  for each row execute function public.touch_updated_at();

create table if not exists public.license_activations (
  id            uuid primary key default gen_random_uuid(),
  license_id    uuid not null references public.licenses(id) on delete cascade,
  device_id     text not null,
  device_label  text,
  platform      text,
  app_version   text,
  created_at    timestamptz not null default now(),
  last_seen_at  timestamptz not null default now(),
  revoked_at    timestamptz,
  constraint license_activations_device_key unique (license_id, device_id)
);

create index if not exists license_activations_active_idx
  on public.license_activations (license_id)
  where revoked_at is null;

create table if not exists public.license_events (
  id          bigint generated always as identity primary key,
  license_id  uuid not null references public.licenses(id) on delete cascade,
  event_type  text not null,
  detail      jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now()
);

create index if not exists license_events_license_idx
  on public.license_events (license_id, created_at desc);

-- ------------------------------------------------------------
-- RLS: tutto chiuso. Il client non legge nemmeno i metadati:
-- la dashboard passa da license-me, che decide cosa esporre.
-- ------------------------------------------------------------
alter table public.licenses enable row level security;
alter table public.license_activations enable row level security;
alter table public.license_events enable row level security;

revoke all on public.licenses from anon, authenticated;
revoke all on public.license_activations from anon, authenticated;
revoke all on public.license_events from anon, authenticated;
revoke all on sequence public.license_events_id_seq from anon, authenticated;

-- ------------------------------------------------------------
-- Attivazione atomica (solo service_role)
-- ------------------------------------------------------------
-- Blocca la riga della licenza, verifica stato/scadenza/posti e collega
-- il dispositivo. Se la licenza lifetime è ancora senza proprietario,
-- la assegna all'utente autenticato che la inserisce per primo.
create or replace function public.license_attach_device(
  p_license_id  uuid,
  p_user_id     uuid,
  p_device_id   text,
  p_device_label text,
  p_platform    text,
  p_app_version text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  lic        public.licenses;
  act        public.license_activations;
  active_n   integer;
begin
  if p_user_id is null or p_device_id is null or length(p_device_id) < 16 then
    return jsonb_build_object('error', 'bad_request');
  end if;

  select * into lic from public.licenses where id = p_license_id for update;
  if not found then
    return jsonb_build_object('error', 'not_found');
  end if;

  if lic.user_id is null then
    if lic.plan <> 'lifetime' then
      return jsonb_build_object('error', 'not_claimable');
    end if;
    if exists (select 1 from public.licenses where user_id = p_user_id) then
      return jsonb_build_object('error', 'already_licensed');
    end if;
    update public.licenses
       set user_id = p_user_id,
           claimed_at = now()
     where id = lic.id
     returning * into lic;
  elsif lic.user_id <> p_user_id then
    return jsonb_build_object('error', 'forbidden');
  end if;

  if lic.status = 'revoked' or lic.status = 'expired' or lic.status = 'canceled' then
    return jsonb_build_object('error', 'inactive', 'status', lic.status);
  end if;

  if lic.expires_at is not null and lic.expires_at <= now() then
    update public.licenses set status = 'expired' where id = lic.id;
    return jsonb_build_object('error', 'inactive', 'status', 'expired');
  end if;

  select * into act
    from public.license_activations
   where license_id = lic.id and device_id = p_device_id;

  if act.id is not null and act.revoked_at is null then
    update public.license_activations
       set last_seen_at = now(),
           device_label = coalesce(p_device_label, device_label),
           platform = coalesce(p_platform, platform),
           app_version = coalesce(p_app_version, app_version)
     where id = act.id;
    update public.licenses set last_seen_at = now() where id = lic.id;
    return jsonb_build_object(
      'ok', true,
      'reused', true,
      'license', jsonb_build_object(
        'id', lic.id, 'user_id', lic.user_id, 'plan', lic.plan,
        'status', lic.status, 'max_seats', lic.max_seats,
        'issued_at', lic.issued_at, 'expires_at', lic.expires_at
      )
    );
  end if;

  select count(*) into active_n
    from public.license_activations
   where license_id = lic.id and revoked_at is null;

  if active_n >= lic.max_seats then
    return jsonb_build_object('error', 'seats_exceeded', 'max_seats', lic.max_seats);
  end if;

  if act.id is not null then
    update public.license_activations
       set revoked_at = null,
           last_seen_at = now(),
           device_label = coalesce(p_device_label, device_label),
           platform = coalesce(p_platform, platform),
           app_version = coalesce(p_app_version, app_version)
     where id = act.id;
  else
    insert into public.license_activations
      (license_id, device_id, device_label, platform, app_version)
    values
      (lic.id, p_device_id, p_device_label, p_platform, p_app_version);
  end if;

  update public.licenses set last_seen_at = now() where id = lic.id;

  insert into public.license_events (license_id, event_type, detail)
  values (
    lic.id,
    'activated',
    jsonb_build_object('device_id', p_device_id, 'platform', p_platform, 'app_version', p_app_version)
  );

  return jsonb_build_object(
    'ok', true,
    'reused', false,
    'license', jsonb_build_object(
      'id', lic.id, 'user_id', lic.user_id, 'plan', lic.plan,
      'status', lic.status, 'max_seats', lic.max_seats,
      'issued_at', lic.issued_at, 'expires_at', lic.expires_at
    )
  );
end;
$$;

revoke all on function public.license_attach_device(uuid, uuid, text, text, text, text) from public, anon, authenticated;
grant execute on function public.license_attach_device(uuid, uuid, text, text, text, text) to service_role;

-- ------------------------------------------------------------
-- Disattivazione dispositivo (solo service_role)
-- ------------------------------------------------------------
create or replace function public.license_detach_device(
  p_license_id uuid,
  p_user_id    uuid,
  p_device_id  text
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  lic public.licenses;
  hit integer;
begin
  select * into lic from public.licenses where id = p_license_id for update;
  if not found or lic.user_id is distinct from p_user_id then
    return false;
  end if;

  update public.license_activations
     set revoked_at = now()
   where license_id = lic.id and device_id = p_device_id and revoked_at is null;
  get diagnostics hit = row_count;

  if hit > 0 then
    insert into public.license_events (license_id, event_type, detail)
    values (lic.id, 'deactivated', jsonb_build_object('device_id', p_device_id));
  end if;

  return hit > 0;
end;
$$;

revoke all on function public.license_detach_device(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.license_detach_device(uuid, uuid, text) to service_role;
