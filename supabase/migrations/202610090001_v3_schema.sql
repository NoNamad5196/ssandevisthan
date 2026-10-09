-- SSANDEVISTHAN v3: additive initial schema. No existing project/data is dropped.
create extension if not exists pgcrypto with schema extensions;

create table public.upload_sessions (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  status text not null default 'PENDING' check(status in ('PENDING','PROCESSING','STORED','READY','CONSUMED','DELETING','DELETED','EXPIRED')),
  object_key text unique, declared_mime text not null check(declared_mime in ('image/jpeg','image/png','image/webp')),
  declared_bytes bigint not null check(declared_bytes between 1 and 10000000),
  raw_sha256 text, normalized_sha256 text, normalizer_version text,
  width integer check(width > 0 and width <= 1600), height integer check(height > 0 and height <= 1600),
  normalized_bytes bigint check(normalized_bytes between 1 and 10000000),
  lease_token uuid, lease_expires_at timestamptz, consumed_by uuid unique,
  created_at timestamptz not null default now(), expires_at timestamptz not null default now()+interval '1 hour', deleted_at timestamptz,
  check(expires_at <= created_at + interval '1 hour')
);
create table public.search_runs (
  id uuid primary key default gen_random_uuid(), owner_id uuid not null references auth.users(id) on delete cascade,
  mode text not null check(mode in ('IMAGE_SIMILAR','DEAL_TEXT')), schema_version smallint not null default 3 check(schema_version=3),
  input_digest text not null, input_descriptor jsonb not null, upload_id uuid references public.upload_sessions(id) on delete set null,
  query_text text, status text not null default 'QUEUED' check(status in ('QUEUED','RUNNING','COMPLETED','PARTIAL','NO_RELIABLE_MATCH','FAILED','CANCELED','EXPIRED')),
  stage text check(stage in ('VALIDATING','ANALYZING','DISCOVERING','EXTRACTING','COMPARING','RANKING')),
  result_limit smallint not null default 10 check(result_limit between 1 and 10), target_attributes jsonb not null default '{}',
  identified_original jsonb, versions jsonb not null, warning_codes jsonb not null default '[]', failure jsonb,
  progress jsonb not null default '{"discoveredUrls":0,"deduplicatedUrls":0,"extractedCandidates":0,"comparedCandidates":0}',
  created_at timestamptz not null default now(), started_at timestamptz, deadline_at timestamptz not null default now()+interval '90 seconds',
  completed_at timestamptz, expires_at timestamptz not null default now()+interval '7 days', cancel_requested_at timestamptz, deleted_at timestamptz,
  check(deadline_at > created_at and deadline_at <= created_at+interval '90 seconds'), check(expires_at <= created_at+interval '7 days'),
  unique(id,owner_id)
);
alter table public.upload_sessions add foreign key(consumed_by) references public.search_runs(id) on delete set null;
create table public.search_idempotency (
  owner_id uuid not null references auth.users(id) on delete cascade, key_hash text not null, input_digest text not null,
  search_id uuid references public.search_runs(id) on delete set null, deleted boolean not null default false,
  expires_at timestamptz not null, primary key(owner_id,key_hash)
);
create table public.search_jobs (
  id bigint generated always as identity primary key, search_id uuid not null references public.search_runs(id) on delete cascade,
  operation_key text not null, stage text not null check(stage in ('VALIDATING','ANALYZING','DISCOVERING','EXTRACTING','COMPARING','RANKING')),
  state text not null default 'READY' check(state in ('READY','LEASED','DONE','FAILED','CANCELED')), checkpoint jsonb not null default '{}',
  attempt integer not null default 0 check(attempt>=0), max_attempts smallint not null default 2 check(max_attempts between 1 and 2),
  available_at timestamptz not null default now(), lease_token uuid, lease_expires_at timestamptz, last_error_code text,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique(search_id,operation_key)
);
create table public.search_queries (
  id uuid primary key default gen_random_uuid(), search_id uuid not null references public.search_runs(id) on delete cascade,
  ordinal smallint not null check(ordinal between 1 and 8), query_text text not null, query_type text not null, source_target text,
  created_at timestamptz not null default now(), unique(search_id,ordinal)
);
-- Pilot balance has NO calendar reset. Reconciliation and rates must be supplied by operator.
create table public.pilot_budget (
  id boolean primary key default true check(id), ceiling_microusd bigint not null default 20000000 check(ceiling_microusd between 0 and 20000000),
  spent_microusd bigint not null default 0 check(spent_microusd>=0), history_verified_at timestamptz,
  enabled boolean not null default false, search_ceiling_microusd bigint check(search_ceiling_microusd > 0),
  rates jsonb, rates_verified_at timestamptz, model_verified_at timestamptz, free_quota_verified_at timestamptz,
  updated_at timestamptz not null default now()
);
insert into public.pilot_budget(id) values(true);
create table public.budget_reservations (
  id uuid primary key default gen_random_uuid(), search_id uuid references public.search_runs(id) on delete set null,
  operation_key text not null, reserved_microusd bigint not null check(reserved_microusd>=0), actual_microusd bigint check(actual_microusd>=0),
  state text not null default 'RESERVED' check(state in ('RESERVED','SETTLED','RELEASED')), created_at timestamptz not null default now(), settled_at timestamptz,
  unique(search_id,operation_key)
);
create table public.provider_runs (
  id uuid primary key default gen_random_uuid(), search_id uuid not null references public.search_runs(id) on delete cascade,
  operation_key text not null, provider text not null, operation text not null, status text not null,
  attempt smallint not null check(attempt between 1 and 2), latency_ms integer, request_units jsonb not null default '{}',
  cost_microusd bigint check(cost_microusd>=0), error_code text, provider_request_id text,
  created_at timestamptz not null default now(), unique(search_id,operation_key,attempt)
);
create table public.products (
  id uuid primary key default gen_random_uuid(), search_id uuid not null references public.search_runs(id) on delete cascade,
  canonical_url text not null, canonical_url_hash text not null, source text not null, source_product_key text,
  title text not null, brand text, category text, model_code text, normalized_attributes jsonb not null default '{}',
  created_at timestamptz not null default now(), unique(search_id,source,canonical_url_hash), unique(id,search_id)
);
create table public.product_variants (
  id uuid primary key default gen_random_uuid(), search_id uuid not null references public.search_runs(id) on delete cascade,
  product_id uuid not null, source_variant_key text, variant_key_hash text not null, color text, size text,
  options jsonb not null default '{}', selection_required boolean not null default true, observed_at timestamptz not null,
  unique(product_id,variant_key_hash), unique(id,search_id), foreign key(product_id,search_id) references public.products(id,search_id) on delete cascade
);
create table public.offers (
  id uuid primary key default gen_random_uuid(), search_id uuid not null references public.search_runs(id) on delete cascade,
  product_id uuid not null, variant_id uuid not null, merchant text not null, product_url text not null,
  condition text not null check(condition in ('NEW','USED','UNKNOWN')), domestic_shipping text not null check(domestic_shipping in ('CONFIRMED','REJECTED','UNKNOWN')),
  overseas_direct boolean, rental boolean, currency char(3) not null default 'KRW' check(currency='KRW'),
  item_price bigint check(item_price>0), shipping_fee bigint check(shipping_fee>=0), effective_price bigint,
  price_basis text not null check(price_basis in ('TOTAL_PRICE','ITEM_PRICE_ONLY','UNKNOWN')),
  stock_status text not null check(stock_status in ('IN_STOCK','OUT_OF_STOCK','UNKNOWN')), conditional_prices jsonb not null default '[]',
  price_observed_at timestamptz, stock_observed_at timestamptz, price_evidence_id uuid, shipping_evidence_id uuid,
  unique(id,search_id), foreign key(product_id,search_id) references public.products(id,search_id) on delete cascade,
  foreign key(variant_id,search_id) references public.product_variants(id,search_id) on delete cascade,
  check ((item_price is null and price_basis='UNKNOWN' and effective_price is null)
    or (item_price is not null and shipping_fee is null and price_basis='ITEM_PRICE_ONLY' and effective_price is null)
    or (item_price is not null and shipping_fee is not null and price_basis='TOTAL_PRICE' and effective_price=item_price+shipping_fee))
);
create table public.product_images (
  id uuid primary key default gen_random_uuid(), search_id uuid not null references public.search_runs(id) on delete cascade,
  product_id uuid not null, variant_id uuid, image_url text not null, image_url_hash text not null, source_url text not null,
  image_source text not null check(image_source in ('merchant_page','merchant_cdn','merchant_metadata','search_thumbnail','fallback_same_product','placeholder')),
  extraction_stage text not null check(extraction_stage in ('STATIC_HTML','METADATA','BROWSER_DOM','BROWSER_NETWORK','SEARCH_THUMBNAIL','FALLBACK_SEARCH','PLACEHOLDER')),
  verified_same_product boolean not null, is_merchant_image boolean not null, image_observed_at timestamptz not null, evidence_id uuid,
  unique(product_id,image_url_hash), foreign key(product_id,search_id) references public.products(id,search_id) on delete cascade,
  foreign key(variant_id,search_id) references public.product_variants(id,search_id) on delete cascade
);
create table public.search_candidates (
  id uuid primary key default gen_random_uuid(), search_id uuid not null references public.search_runs(id) on delete cascade, product_id uuid,
  canonical_url_hash text not null, canonical_url text not null, discovery_query_ids uuid[] not null default '{}', discovery_sources text[] not null default '{}',
  metadata_status text not null default 'PENDING', image_status text not null default 'PENDING', price_status text not null default 'UNKNOWN',
  source_policy_status text not null default 'UNKNOWN', visual_similarity numeric(6,5) check(visual_similarity between 0 and 1),
  attribute_similarity numeric(6,5) check(attribute_similarity between 0 and 1), visual_coverage numeric(6,5) check(visual_coverage between 0 and 1),
  attribute_coverage numeric(6,5) check(attribute_coverage between 0 and 1), total_similarity numeric(6,5) check(total_similarity between 0 and 1),
  gate_status text not null default 'UNEVALUATED', reject_reasons text[] not null default '{}',
  snapshot jsonb, created_at timestamptz not null default now(), unique(search_id,canonical_url_hash), unique(id,search_id),
  foreign key(product_id,search_id) references public.products(id,search_id) on delete cascade
);
create table public.field_evidence (
  id uuid primary key default gen_random_uuid(), search_id uuid not null references public.search_runs(id) on delete cascade,
  candidate_id uuid, product_id uuid, offer_id uuid, variant_id uuid, field_path text not null, value_json jsonb,
  source_url text not null, source_kind text not null check(source_kind in ('MERCHANT_PAGE','MERCHANT_METADATA','MERCHANT_IMAGE','SEARCH_RESULT','COMMUNITY_POST','MODEL_INFERENCE')),
  extraction_method text not null, evidence_excerpt text check(length(evidence_excerpt)<=512), content_sha256 text,
  observed_at timestamptz not null, confidence text not null check(confidence in ('VERIFIED','PROBABLE','UNKNOWN')), extractor_version text not null,
  unique(id,search_id), foreign key(candidate_id,search_id) references public.search_candidates(id,search_id) on delete cascade,
  foreign key(product_id,search_id) references public.products(id,search_id) on delete cascade,
  foreign key(offer_id,search_id) references public.offers(id,search_id) on delete cascade,
  foreign key(variant_id,search_id) references public.product_variants(id,search_id) on delete cascade,
  check(source_kind <> 'MODEL_INFERENCE' or field_path not in ('/itemPrice','/shippingFee','/stockStatus','/condition','/domesticShipping'))
);
create table public.price_observations (
  id uuid primary key default gen_random_uuid(), search_id uuid not null references public.search_runs(id) on delete cascade,
  offer_id uuid not null, observed_at timestamptz not null, item_price bigint check(item_price>0), shipping_fee bigint check(shipping_fee>=0),
  conditional_prices jsonb not null default '[]', currency char(3) not null check(currency='KRW'), evidence_id uuid not null, extractor_version text not null,
  foreign key(offer_id,search_id) references public.offers(id,search_id) on delete cascade,
  foreign key(evidence_id,search_id) references public.field_evidence(id,search_id) on delete cascade
);
create table public.search_results (
  id uuid primary key default gen_random_uuid(), search_id uuid not null references public.search_runs(id) on delete cascade,
  product_id uuid not null, offer_id uuid, mode text not null check(mode in ('IMAGE_SIMILAR','DEAL_TEXT')),
  kind text not null check(kind in ('RECOMMENDATION','REFERENCE')), price_basis text not null check(price_basis in ('TOTAL_PRICE','ITEM_PRICE_ONLY','UNKNOWN')),
  cohort_rank smallint check(cohort_rank between 1 and 10), final_score numeric(6,5) check(final_score between 0 and 1), deal_relevance numeric(6,5) check(deal_relevance between 0 and 1),
  snapshot jsonb not null, created_at timestamptz not null default now(),
  foreign key(product_id,search_id) references public.products(id,search_id) on delete cascade,
  foreign key(offer_id,search_id) references public.offers(id,search_id) on delete cascade,
  check((kind='REFERENCE' and price_basis='UNKNOWN' and cohort_rank is null and final_score is null and deal_relevance is null)
    or(kind='RECOMMENDATION' and offer_id is not null and price_basis in ('TOTAL_PRICE','ITEM_PRICE_ONLY') and cohort_rank is not null)),
  check(kind<>'RECOMMENDATION' or (mode='IMAGE_SIMILAR' and final_score is not null and deal_relevance is null)
    or(mode='DEAL_TEXT' and final_score is null and deal_relevance is not null))
);
create table public.search_rank_snapshots (
  search_id uuid primary key references public.search_runs(id) on delete cascade,
  eligible jsonb not null check(jsonb_typeof(eligible)='array' and jsonb_array_length(eligible)<=30),
  references_json jsonb not null check(jsonb_typeof(references_json)='array' and jsonb_array_length(references_json)<=5),
  sort_orders jsonb not null, versions jsonb not null, created_at timestamptz not null default now()
);
create table public.cleanup_tasks (
  id bigint generated always as identity primary key, owner_id uuid, search_id uuid, upload_id uuid, object_key text,
  reason text not null, state text not null default 'READY' check(state in ('READY','LEASED','DONE')),
  attempt integer not null default 0, available_at timestamptz not null default now(), created_at timestamptz not null default now(), completed_at timestamptz,
  unique(upload_id)
);
create table public.request_rate_events (
  id bigint generated always as identity primary key, owner_id uuid not null references auth.users(id) on delete cascade,
  ip_hash text not null, created_at timestamptz not null default now()
);
create index search_runs_owner_history_idx on public.search_runs(owner_id,created_at desc,id desc) where deleted_at is null;
create index search_runs_deadline_idx on public.search_runs(deadline_at) where status in ('QUEUED','RUNNING');
create index search_runs_expiry_idx on public.search_runs(expires_at);
create index search_jobs_ready_idx on public.search_jobs(available_at,id) where state='READY';
create index search_jobs_lease_idx on public.search_jobs(lease_expires_at,id) where state='LEASED';
create index upload_expiry_idx on public.upload_sessions(expires_at);
create index upload_owner_idx on public.upload_sessions(owner_id,created_at desc);
create index idempotency_expiry_idx on public.search_idempotency(expires_at);
create index cleanup_ready_idx on public.cleanup_tasks(state,available_at);
create index evidence_fields_idx on public.field_evidence(search_id,field_path);
create index price_observations_idx on public.price_observations(offer_id,observed_at desc);
create index rate_owner_idx on public.request_rate_events(owner_id,created_at desc);
create index rate_ip_idx on public.request_rate_events(ip_hash,created_at desc);
create unique index search_results_offer_idx on public.search_results(search_id,offer_id) where offer_id is not null;
create unique index search_results_rank_idx on public.search_results(search_id,price_basis,cohort_rank) where kind='RECOMMENDATION';

do $$ declare t text; begin
  foreach t in array array['upload_sessions','search_runs','search_idempotency','search_jobs','search_queries','pilot_budget','budget_reservations','provider_runs','products','product_variants','offers','product_images','search_candidates','field_evidence','price_observations','search_results','search_rank_snapshots','cleanup_tasks','request_rate_events'] loop
    execute format('alter table public.%I enable row level security',t);
    execute format('revoke all on public.%I from anon, authenticated',t);
    execute format('grant all on public.%I to service_role',t);
    if t not in ('search_runs','upload_sessions','search_idempotency','pilot_budget','cleanup_tasks','request_rate_events') then
      execute format('create index %I on public.%I(search_id)',t||'_search_idx',t);
    end if;
  end loop;
end $$;
grant usage,select on all sequences in schema public to service_role;
grant select on public.search_runs, public.search_results to authenticated;
create policy own_live_runs on public.search_runs for select to authenticated
  using(owner_id=(select auth.uid()) and deleted_at is null and expires_at>now());
create policy own_live_results on public.search_results for select to authenticated using(exists(
  select 1 from public.search_runs r where r.id=search_results.search_id and r.owner_id=(select auth.uid()) and r.deleted_at is null and r.expires_at>now()));
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
  values('normalized-inputs','normalized-inputs',false,10000000,array['image/webp']) on conflict(id) do nothing;
-- No client storage policy: only the authenticated API service may access input objects.
