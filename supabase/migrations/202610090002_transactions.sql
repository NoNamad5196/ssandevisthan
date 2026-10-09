-- All mutation RPCs are server-only; API checks the verified JWT owner separately.
create function public.accept_search(p_owner uuid,p_key_hash text,p_mode text,p_input jsonb,p_versions jsonb,p_ip_hash text)
returns jsonb language plpgsql security definer set search_path=public,extensions as $$
declare b pilot_budget; u upload_sessions; old search_idempotency; r search_runs; descr jsonb; dig text; pending bigint;
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
    or b.free_quota_verified_at is null or b.rates is null or b.search_ceiling_microusd is null then raise exception 'TEMPORARILY_UNAVAILABLE'; end if;
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
  if b.spent_microusd+pending+b.search_ceiling_microusd>b.ceiling_microusd then raise exception 'BUDGET_LIMITED'; end if;
  insert into search_runs(owner_id,mode,input_digest,input_descriptor,upload_id,query_text,result_limit,versions)
    values(p_owner,p_mode,dig,descr,u.id,p_input->>'query',(p_input->>'resultLimit')::smallint,p_versions) returning * into r;
  insert into search_idempotency(owner_id,key_hash,input_digest,search_id,expires_at) values(p_owner,p_key_hash,dig,r.id,r.expires_at);
  insert into budget_reservations(search_id,operation_key,reserved_microusd) values(r.id,'SEARCH',b.search_ceiling_microusd);
  if u.id is not null then update upload_sessions set status='CONSUMED',consumed_by=r.id where id=u.id; end if;
  insert into search_jobs(search_id,operation_key,stage) values(r.id,'validate','VALIDATING');
  insert into request_rate_events(owner_id,ip_hash) values(p_owner,p_ip_hash);
  return jsonb_build_object('run',to_jsonb(r),'reused',false);
end $$;

create function public.claim_search_job() returns setof public.search_jobs language plpgsql security definer set search_path=public as $$
declare picked search_jobs; begin
  select j.* into picked from search_jobs j join search_runs r on r.id=j.search_id
    where (j.state='READY' or(j.state='LEASED' and j.lease_expires_at<now())) and j.available_at<=now() and j.attempt<j.max_attempts
    and r.status in ('QUEUED','RUNNING') and r.deleted_at is null and r.deadline_at>now()
    order by j.available_at,j.id for update of r,j skip locked limit 1;
  if picked.id is null then return; end if;
  update search_runs set status='RUNNING',stage=picked.stage,started_at=coalesce(started_at,now()) where id=picked.search_id;
  return query update search_jobs set state='LEASED',attempt=attempt+1,lease_token=gen_random_uuid(),lease_expires_at=now()+interval '20 seconds',updated_at=now()
    where id=picked.id returning *;
end $$;

create function public.assert_lease(p_job bigint,p_token uuid,p_attempt integer) returns uuid language plpgsql security definer set search_path=public as $$
declare j search_jobs; r search_runs; begin
  select r0.* into r from search_runs r0 join search_jobs j0 on r0.id=j0.search_id where j0.id=p_job for update of r0;
  select * into j from search_jobs where id=p_job for update;
  if r.id is null or j.state<>'LEASED' or j.lease_token is distinct from p_token or j.attempt<>p_attempt or j.lease_expires_at<=now()
    or r.status not in ('QUEUED','RUNNING') or r.deleted_at is not null or r.deadline_at<=now() then raise exception 'LEASE_LOST'; end if;
  return r.id;
end $$;

create function public.reserve_provider(p_job bigint,p_token uuid,p_attempt integer,p_operation text,p_key text,p_worst bigint)
returns jsonb language plpgsql security definer set search_path=public as $$
declare sid uuid; b pilot_budget; top budget_reservations; prior budget_reservations; spent bigint; n integer; lim integer; begin
  -- Same global-to-run lock order as accept/settle avoids budget deadlocks.
  select * into b from pilot_budget where id=true for update;
  sid:=assert_lease(p_job,p_token,p_attempt);
  if not b.enabled or b.history_verified_at is null or b.rates_verified_at is null then raise exception 'OPERATOR_STOP'; end if;
  select * into prior from budget_reservations where search_id=sid and operation_key=p_key;
  if found then raise exception 'PROVIDER_OUTCOME_UNKNOWN'; end if; -- No paid replay after ambiguous completion.
  if p_operation not in ('analysis','discovery','comparison') or p_worst<=0 then raise exception 'INVALID_INPUT'; end if;
  lim:=case p_operation when 'analysis' then 2 when 'discovery' then 8 else 4 end;
  if (select count(*) from provider_runs where search_id=sid)>=14 or (select count(*) from provider_runs where search_id=sid and operation=p_operation)>=lim then raise exception 'PROVIDER_CALL_CAP'; end if;
  if (select count(*) from provider_runs where status='STARTED')>=2 then raise exception 'PROVIDER_CONCURRENCY_LIMIT'; end if;
  select * into top from budget_reservations where search_id=sid and operation_key='SEARCH' and state='RESERVED' for update;
  select coalesce(sum(case when state='SETTLED' then actual_microusd when state='RESERVED' then reserved_microusd else 0 end),0) into spent
    from budget_reservations where search_id=sid and operation_key<>'SEARCH';
  if top.id is null or spent+p_worst>top.reserved_microusd then raise exception 'BUDGET_LIMITED'; end if;
  insert into budget_reservations(search_id,operation_key,reserved_microusd) values(sid,p_key,p_worst);
  insert into provider_runs(search_id,operation_key,provider,operation,status,attempt) values(sid,p_key,'openai',p_operation,'STARTED',p_attempt);
  return jsonb_build_object('rates',b.rates,'reservedMicrousd',p_worst);
end $$;

create function public.settle_provider(p_search uuid,p_key text,p_actual bigint,p_units jsonb,p_request_id text,p_latency integer,p_error text default null)
returns void language plpgsql security definer set search_path=public as $$
declare b pilot_budget; res budget_reservations; begin
  select * into b from pilot_budget where id=true for update;
  select * into res from budget_reservations where search_id=p_search and operation_key=p_key for update;
  if res.id is null then raise exception 'RESERVATION_MISSING'; end if;
  if res.state<>'RESERVED' then return; end if;
  if p_actual is null then
    update provider_runs set status='UNCERTAIN',error_code=p_error,latency_ms=p_latency,provider_request_id=p_request_id where search_id=p_search and operation_key=p_key;
    return; -- Keep entire unknown reservation; never assume timeout was free.
  end if;
  if p_actual<0 then raise exception 'INVALID_INPUT'; end if;
  if p_actual>res.reserved_microusd then update pilot_budget set enabled=false where id=true; end if;
  update budget_reservations set state='SETTLED',actual_microusd=p_actual,settled_at=now() where id=res.id;
  update provider_runs set status=case when p_error is null then 'COMPLETED' else 'FAILED' end,cost_microusd=p_actual,
    request_units=p_units,provider_request_id=p_request_id,latency_ms=p_latency,error_code=p_error where search_id=p_search and operation_key=p_key;
  -- SEARCH reserves the whole amount until terminal; operation totals are NOT added globally twice.
end $$;

create function public.close_search_budget(p_search uuid) returns void language plpgsql security definer set search_path=public as $$
declare b pilot_budget; top budget_reservations; actual bigint; uncertain bigint; begin
  select * into b from pilot_budget where id=true for update;
  -- Stop counting an interrupted terminal operation as active. Its reservation
  -- remains held until actual usage is reconciled; uncertainty is never a refund.
  update provider_runs set status='UNCERTAIN',error_code='WORKER_INTERRUPTED' where search_id=p_search and status='STARTED'
    and exists(select 1 from search_runs where id=p_search and status not in ('QUEUED','RUNNING'));
  select * into top from budget_reservations where search_id=p_search and operation_key='SEARCH' for update;
  if top.id is null or top.state<>'RESERVED' then return; end if;
  select coalesce(sum(actual_microusd) filter(where state='SETTLED'),0),coalesce(sum(reserved_microusd) filter(where state='RESERVED'),0)
    into actual,uncertain from budget_reservations where search_id=p_search and operation_key<>'SEARCH';
  if uncertain>0 then return; end if; -- Reconciliation owns uncertain top-level releases.
  update pilot_budget set spent_microusd=spent_microusd+actual,updated_at=now() where id=true;
  update budget_reservations set state='SETTLED',actual_microusd=actual,settled_at=now() where id=top.id;
end $$;

create function public.queue_input_cleanup(p_search uuid,p_immediate boolean default false) returns void language plpgsql security definer set search_path=public as $$
begin
  insert into cleanup_tasks(owner_id,search_id,upload_id,object_key,reason,available_at)
    select owner_id,p_search,id,object_key,case when p_immediate then 'DELETE' else 'TERMINAL' end,
      case when p_immediate then now() else least(expires_at,now()+interval '4 minutes') end
    from upload_sessions where consumed_by=p_search and object_key is not null
    on conflict(upload_id) do update set available_at=least(cleanup_tasks.available_at,excluded.available_at);
end $$;

create function public.commit_search_step(p_job bigint,p_token uuid,p_attempt integer,p_payload jsonb)
returns void language plpgsql security definer set search_path=public as $$
declare sid uuid; r search_runs; item jsonb; terminal text; cid uuid; begin
  -- Lock budget before run for all paths that can finalize.
  perform 1 from pilot_budget where id=true for update;
  sid:=assert_lease(p_job,p_token,p_attempt);
  select * into r from search_runs where id=sid;
  if p_payload ? 'targetAttributes' then update search_runs set target_attributes=p_payload->'targetAttributes' where id=sid; end if;
  if p_payload ? 'progress' then update search_runs set progress=progress||(p_payload->'progress') where id=sid; end if;
  if p_payload ? 'warnings' then update search_runs set warning_codes=warning_codes||(p_payload->'warnings') where id=sid; end if;
  for item in select value from jsonb_array_elements(coalesce(p_payload->'queries','[]')) loop
    insert into search_queries(id,search_id,ordinal,query_text,query_type) values((item->>'id')::uuid,sid,(item->>'ordinal')::smallint,item->>'query',item->>'type') on conflict(search_id,ordinal) do nothing;
  end loop;
  for item in select value from jsonb_array_elements(coalesce(p_payload->'discoveries','[]')) loop
    if (select count(*) from search_candidates where search_id=sid)>=60 then exit; end if;
    insert into search_candidates(id,search_id,canonical_url_hash,canonical_url,discovery_query_ids,discovery_sources)
      values((item->>'id')::uuid,sid,item->>'urlHash',item->>'url',array[(item->>'queryId')::uuid],array['openai_web_search'])
      on conflict(search_id,canonical_url_hash) do update set discovery_query_ids=(select array_agg(distinct x) from unnest(search_candidates.discovery_query_ids||excluded.discovery_query_ids) x)
      returning id into cid;
    insert into field_evidence(search_id,candidate_id,field_path,value_json,source_url,source_kind,extraction_method,observed_at,confidence,extractor_version)
      values(sid,cid,'/discovery',item-'url',item->>'url','SEARCH_RESULT','web_search_call.sources',now(),'VERIFIED','discovery-v3');
  end loop;
  for item in select value from jsonb_array_elements(coalesce(p_payload->'candidateUpdates','[]')) loop
    update search_candidates set snapshot=coalesce(item->'snapshot',snapshot),metadata_status=coalesce(item->>'metadataStatus',metadata_status),
      image_status=coalesce(item->>'imageStatus',image_status),gate_status=coalesce(item->>'gateStatus',gate_status),
      reject_reasons=case when item ? 'rejectReasons' then array(select jsonb_array_elements_text(item->'rejectReasons')) else reject_reasons end
      where id=(item->>'id')::uuid and search_id=sid;
  end loop;
  for item in select value from jsonb_array_elements(coalesce(p_payload->'records','[]')) loop
    perform public.persist_extracted_candidate(sid,item);
  end loop;
  for item in select value from jsonb_array_elements(coalesce(p_payload->'settlements','[]')) loop
    if (item->>'p_search')::uuid<>sid then raise exception 'CROSS_SEARCH_SETTLEMENT'; end if;
    perform settle_provider(sid,item->>'p_key',(item->>'p_actual')::bigint,item->'p_units',item->>'p_request_id',(item->>'p_latency')::integer,item->>'p_error');
  end loop;
  terminal:=p_payload->>'terminal';
  if terminal is not null then
    if terminal not in ('COMPLETED','PARTIAL','NO_RELIABLE_MATCH','FAILED','EXPIRED') then raise exception 'INVALID_TERMINAL'; end if;
    if jsonb_array_length(coalesce(p_payload->'eligible','[]'))>(case when r.mode='IMAGE_SIMILAR' then 20 else 30 end) then raise exception 'CANDIDATE_CAP'; end if;
    if (terminal in ('COMPLETED','PARTIAL'))<>(jsonb_array_length(coalesce(p_payload->'eligible','[]'))>0) then raise exception 'INVALID_TERMINAL_RESULTS'; end if;
    insert into search_rank_snapshots(search_id,eligible,references_json,sort_orders,versions)
      values(sid,coalesce(p_payload->'eligible','[]'),coalesce(p_payload->'references','[]'),coalesce(p_payload->'sortOrders','{}'),r.versions);
    for item in select value from jsonb_array_elements(coalesce(p_payload->'results','[]')) loop
      insert into search_results(search_id,product_id,offer_id,mode,kind,price_basis,cohort_rank,final_score,deal_relevance,snapshot)
        values(sid,(item->>'productId')::uuid,(item->>'offerId')::uuid,r.mode,'RECOMMENDATION',item->>'priceBasis',(item->>'cohortRank')::smallint,(item->>'finalScore')::numeric,(item->>'dealRelevance')::numeric,item);
    end loop;
    update search_runs set status=terminal,completed_at=now(),failure=p_payload->'failure' where id=sid;
    perform queue_input_cleanup(sid,false);
    perform close_search_budget(sid);
  else
    for item in select value from jsonb_array_elements(coalesce(p_payload->'nextJobs','[]')) loop
      insert into search_jobs(search_id,operation_key,stage,checkpoint,available_at)
        values(sid,item->>'key',item->>'stage',coalesce(item->'checkpoint','{}'),coalesce((item->>'availableAt')::timestamptz,now())) on conflict(search_id,operation_key) do nothing;
    end loop;
  end if;
  update search_jobs set state='DONE',lease_token=null,lease_expires_at=null,checkpoint=coalesce(p_payload->'checkpoint',checkpoint),updated_at=now() where id=p_job;
end $$;

create function public.cancel_search(p_owner uuid,p_search uuid) returns jsonb language plpgsql security definer set search_path=public as $$
declare r search_runs; begin
  perform 1 from pilot_budget where id=true for update;
  select * into r from search_runs where id=p_search and owner_id=p_owner and deleted_at is null and expires_at>now() for update;
  if r.id is null then raise exception 'NOT_FOUND'; end if;
  if r.status in ('QUEUED','RUNNING') then
    update search_runs set status='CANCELED',completed_at=now(),cancel_requested_at=now() where id=r.id returning * into r;
    update search_jobs set state='CANCELED',lease_token=null,lease_expires_at=null where search_id=r.id and state in ('READY','LEASED');
    perform queue_input_cleanup(r.id,true); perform close_search_budget(r.id);
  end if;
  return to_jsonb(r);
end $$;

create function public.delete_search(p_owner uuid,p_search uuid) returns void language plpgsql security definer set search_path=public as $$
declare r search_runs; begin
  perform 1 from pilot_budget where id=true for update;
  select * into r from search_runs where id=p_search and owner_id=p_owner for update;
  if r.id is null then return; end if;
  update search_idempotency set deleted=true,search_id=null where owner_id=p_owner and search_id=r.id;
  update search_runs set deleted_at=coalesce(deleted_at,now()),status=case when status in ('QUEUED','RUNNING') then 'CANCELED' else status end,completed_at=coalesce(completed_at,now()) where id=r.id;
  update search_jobs set state='CANCELED',lease_token=null,lease_expires_at=null where search_id=r.id and state in ('READY','LEASED');
  perform queue_input_cleanup(r.id,true); perform close_search_budget(r.id);
end $$;

create function public.sweep_searches() returns jsonb language plpgsql security definer set search_path=public as $$
declare r search_runs; n integer:=0; begin
  perform 1 from pilot_budget where id=true for update;
  for r in select * from search_runs where status in ('QUEUED','RUNNING') and (deadline_at<=now() or
    exists(select 1 from search_jobs j where j.search_id=search_runs.id and j.state='LEASED' and j.lease_expires_at<=now() and j.attempt>=j.max_attempts)) for update loop
    -- Checkpoint candidates are only made public by the trusted ranker; no score fabrication on recovery.
    update search_runs set status=case when deadline_at<=now() then 'EXPIRED' else 'FAILED' end,completed_at=now(),
      failure=jsonb_build_object('code',case when deadline_at<=now() then 'DEADLINE_EXCEEDED' else 'PROVIDER_UNAVAILABLE' end,'message','검색을 완료하지 못했어요.','retryable',true) where id=r.id;
    update search_jobs set state='CANCELED',lease_token=null,lease_expires_at=null where search_id=r.id and state in ('READY','LEASED');
    perform queue_input_cleanup(r.id,true); perform close_search_budget(r.id); n:=n+1;
  end loop;
  insert into cleanup_tasks(owner_id,search_id,upload_id,object_key,reason)
    select owner_id,consumed_by,id,object_key,'TTL' from upload_sessions where expires_at<=now() and object_key is not null
    on conflict(upload_id) do update set available_at=least(cleanup_tasks.available_at,now());
  for r in select * from search_runs where expires_at<=now() or deleted_at is not null for update loop
    perform queue_input_cleanup(r.id,true);
    update search_idempotency set deleted=true,search_id=null where search_id=r.id;
    delete from search_runs where id=r.id;
  end loop;
  delete from search_idempotency where expires_at<=now();
  delete from request_rate_events where created_at<now()-interval '10 minutes';
  delete from upload_sessions where (expires_at<=now() or deleted_at is not null) and object_key is null and consumed_by is null;
  return jsonb_build_object('finalized',n);
end $$;

create function public.claim_upload(p_owner uuid,p_upload uuid,p_raw_hash text) returns jsonb language plpgsql security definer set search_path=public as $$
declare u upload_sessions; begin
  select * into u from upload_sessions where id=p_upload and owner_id=p_owner and deleted_at is null for update;
  if u.id is null then raise exception 'NOT_FOUND'; end if;
  if u.expires_at<=now() then raise exception 'UPLOAD_EXPIRED'; end if;
  if u.raw_sha256 is not null and u.raw_sha256<>p_raw_hash then raise exception 'UPLOAD_CONTENT_CHANGED'; end if;
  if u.status in ('STORED','READY') then return to_jsonb(u); end if;
  if u.status='CONSUMED' then raise exception 'UPLOAD_ALREADY_CONSUMED'; end if;
  if u.status='PROCESSING' and u.lease_expires_at>now() then raise exception 'UPLOAD_PROCESSING'; end if;
  update upload_sessions set status='PROCESSING',object_key=p_owner::text||'/'||p_upload::text||'/normalized.webp',raw_sha256=p_raw_hash,lease_token=gen_random_uuid(),lease_expires_at=now()+interval '20 seconds' where id=u.id returning * into u;
  return to_jsonb(u);
end $$;

create function public.store_upload(p_owner uuid,p_upload uuid,p_token uuid,p_metadata jsonb) returns jsonb language plpgsql security definer set search_path=public as $$
declare u upload_sessions; begin
  update upload_sessions set status='STORED',object_key=p_owner::text||'/'||p_upload::text||'/normalized.webp',
    normalized_sha256=p_metadata->>'sha256',width=(p_metadata->>'width')::integer,height=(p_metadata->>'height')::integer,
    normalized_bytes=(p_metadata->>'bytes')::bigint,normalizer_version=p_metadata->>'version',lease_token=null,lease_expires_at=null
    where id=p_upload and owner_id=p_owner and status='PROCESSING' and lease_token=p_token and lease_expires_at>now() and expires_at>now() and deleted_at is null returning * into u;
  if u.id is null then raise exception 'LEASE_LOST'; end if;
  return to_jsonb(u);
end $$;

create function public.delete_upload(p_owner uuid,p_upload uuid) returns void language plpgsql security definer set search_path=public as $$
declare u upload_sessions; begin
  select * into u from upload_sessions where id=p_upload and owner_id=p_owner for update;
  if u.id is null then return; end if;
  if u.consumed_by is not null then raise exception 'UPLOAD_IN_USE'; end if;
  update upload_sessions set status='DELETING',deleted_at=now(),lease_token=null,lease_expires_at=null where id=u.id;
  if u.object_key is not null then insert into cleanup_tasks(owner_id,upload_id,object_key,reason) values(p_owner,u.id,u.object_key,'DELETE') on conflict(upload_id) do update set available_at=now();
  else delete from upload_sessions where id=u.id; end if;
end $$;

do $$ declare f record; begin
  for f in select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on p.pronamespace=n.oid where n.nspname='public' and p.prosecdef loop
    execute format('revoke all on function %s from public,anon,authenticated',f.sig);
    execute format('grant execute on function %s to service_role',f.sig);
  end loop;
end $$;
