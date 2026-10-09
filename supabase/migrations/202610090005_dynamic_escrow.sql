-- A SEARCH reserves the available bounded runway, not an inflexible full ceiling.
-- NULL admission floor blocks new runs until verified rates/profile are configured.
-- Set the floor to max(quoteCost(analysis), quoteCost(discovery), quoteCost(comparison))
-- from the same verified RateConfig, atomically with rates and rates_verified_at.
-- Existing reservations and uncertain outcomes are never reduced by this migration.
alter table public.pilot_budget add column minimum_search_reservation_microusd bigint
  check(minimum_search_reservation_microusd>0 and minimum_search_reservation_microusd<=20000000);
-- All mutation RPCs are server-only; API checks the verified JWT owner separately.
create or replace function public.accept_search(p_owner uuid,p_key_hash text,p_mode text,p_input jsonb,p_versions jsonb,p_ip_hash text)
returns jsonb language plpgsql security definer set search_path=public,extensions as $$
declare b pilot_budget; u upload_sessions; old search_idempotency; r search_runs; descr jsonb; dig text; pending bigint; escrow bigint;
begin
  -- A single budget row serializes balance, idempotency, active slots and rate decisions.
  select * into b from pilot_budget where id=true for update;
  select * into old from search_idempotency where owner_id=p_owner and key_hash=p_key_hash;
  if found then
    if old.deleted then raise exception 'SEARCH_DELETED'; end if;
    select * into r from search_runs where id=old.search_id and owner_id=p_owner;
    if r.id is null or r.deleted_at is not null then raise exception 'SEARCH_DELETED'; end if;
    if r.expires_at<=now() then raise exception 'SEARCH_EXPIRED'; end if;
    if r.mode<>p_mode or (r.input_descriptor-'normalizedSha256'-'normalizerVersion')<>p_input then raise exception 'IDEMPOTENCY_KEY_REUSED'; end if;
    return jsonb_build_object('run',to_jsonb(r),'reused',true);
  end if;
  if not b.enabled or b.history_verified_at is null or b.rates_verified_at is null or b.model_verified_at is null
    or b.free_quota_verified_at is null or b.rates is null or b.search_ceiling_microusd is null or b.minimum_search_reservation_microusd is null or b.minimum_search_reservation_microusd>b.search_ceiling_microusd then raise exception 'TEMPORARILY_UNAVAILABLE'; end if;
  if (select count(*) from search_runs where status in ('QUEUED','RUNNING') and deleted_at is null and deadline_at>now())>=2
    or exists(select 1 from search_runs where owner_id=p_owner and status in ('QUEUED','RUNNING') and deleted_at is null and deadline_at>now()) then raise exception 'RATE_LIMITED'; end if;
  if (select count(*) from request_rate_events where owner_id=p_owner and created_at>now()-interval '10 minutes')>=5
    or (select count(*) from request_rate_events where ip_hash=p_ip_hash and created_at>now()-interval '10 minutes')>=10 then raise exception 'RATE_LIMITED'; end if;
  descr:=p_input;
  if p_mode='IMAGE_SIMILAR' then
    select * into u from upload_sessions where id=(p_input->>'uploadId')::uuid and owner_id=p_owner for update;
    if u.id is null or u.deleted_at is not null then raise exception 'NOT_FOUND'; end if;
    if u.consumed_by is not null then raise exception 'UPLOAD_ALREADY_CONSUMED'; end if;
    if u.expires_at < now()+interval '90 seconds' then raise exception 'UPLOAD_EXPIRED'; end if;
    if u.status<>'READY' or u.normalized_sha256 is null or u.object_key is null then raise exception 'UPLOAD_NOT_READY'; end if;
    descr:=descr||jsonb_build_object('normalizedSha256',u.normalized_sha256,'normalizerVersion',u.normalizer_version);
  elsif p_mode<>'DEAL_TEXT' then raise exception 'INVALID_INPUT'; end if;
  dig:=encode(digest(convert_to(jsonb_build_object('owner',p_owner,'mode',p_mode,'input',descr,'policy','query-nfc-controls-v3-1')::text,'UTF8'),'sha256'),'hex');
  select coalesce(sum(reserved_microusd),0) into pending from budget_reservations where operation_key='SEARCH' and state='RESERVED';
  escrow:=least(b.search_ceiling_microusd,b.ceiling_microusd-b.spent_microusd-pending);
  if escrow<b.minimum_search_reservation_microusd then raise exception 'BUDGET_LIMITED'; end if;
  insert into search_runs(owner_id,mode,input_digest,input_descriptor,upload_id,query_text,result_limit,versions)
    values(p_owner,p_mode,dig,descr,u.id,p_input->>'query',(p_input->>'resultLimit')::smallint,p_versions) returning * into r;
  insert into search_idempotency(owner_id,key_hash,input_digest,search_id,expires_at) values(p_owner,p_key_hash,dig,r.id,r.expires_at);
  insert into budget_reservations(search_id,operation_key,reserved_microusd) values(r.id,'SEARCH',escrow);
  if u.id is not null then update upload_sessions set status='CONSUMED',consumed_by=r.id where id=u.id; end if;
  insert into search_jobs(search_id,operation_key,stage) values(r.id,'validate','VALIDATING');
  insert into request_rate_events(owner_id,ip_hash) values(p_owner,p_ip_hash);
  return jsonb_build_object('run',to_jsonb(r),'reused',false);
end $$;

