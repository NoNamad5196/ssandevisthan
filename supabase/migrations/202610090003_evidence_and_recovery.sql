create function public.persist_extracted_candidate(p_search uuid,c jsonb) returns void language plpgsql security definer set search_path=public as $$
declare e jsonb; basis text; price bigint; shipping bigint; begin
  if not exists(select 1 from search_candidates where id=(c->>'candidateId')::uuid and search_id=p_search) then raise exception 'CANDIDATE_NOT_FOUND'; end if;
  price:=(c->>'itemPrice')::bigint; shipping:=(c->>'shippingFee')::bigint;
  basis:=case when price is null then 'UNKNOWN' when shipping is null then 'ITEM_PRICE_ONLY' else 'TOTAL_PRICE' end;
  insert into products(id,search_id,canonical_url,canonical_url_hash,source,source_product_key,title)
    values((c->>'productId')::uuid,p_search,c->>'productUrl',c->>'canonicalUrlHash',c->>'source',c->>'sourceProductKey',c->>'title');
  insert into product_variants(id,search_id,product_id,source_variant_key,variant_key_hash,color,size,selection_required,observed_at)
    values((c->>'variantId')::uuid,p_search,(c->>'productId')::uuid,c->>'sourceVariantKey',c->>'sourceVariantKey',c->'variant'->>'color',c->'variant'->>'size',(c->'variant'->>'selectionRequired')::boolean,(c->>'observedAt')::timestamptz);
  insert into offers(id,search_id,product_id,variant_id,merchant,product_url,condition,domestic_shipping,overseas_direct,rental,currency,item_price,shipping_fee,effective_price,price_basis,stock_status,conditional_prices,price_observed_at,stock_observed_at)
    values((c->>'offerId')::uuid,p_search,(c->>'productId')::uuid,(c->>'variantId')::uuid,c->>'merchant',c->>'productUrl',c->'eligibility'->>'condition',
      c->'eligibility'->>'domesticShipping',(c->'eligibility'->>'overseasDirect')::boolean,(c->'eligibility'->>'rental')::boolean,'KRW',price,shipping,
      case when basis='TOTAL_PRICE' then price+shipping else null end,basis,c->'eligibility'->>'stockStatus',c->'conditionalPrices',(c->>'priceObservedAt')::timestamptz,(c->>'stockObservedAt')::timestamptz);
  for e in select value from jsonb_array_elements(c->'fieldEvidence') loop
    if (e->>'searchId')::uuid<>p_search or (e->>'candidateId')::uuid<>(c->>'candidateId')::uuid then raise exception 'CROSS_SEARCH_EVIDENCE'; end if;
    insert into field_evidence(id,search_id,candidate_id,product_id,offer_id,variant_id,field_path,value_json,source_url,source_kind,extraction_method,evidence_excerpt,content_sha256,observed_at,confidence,extractor_version)
      values((e->>'id')::uuid,p_search,(e->>'candidateId')::uuid,(e->>'productId')::uuid,(e->>'offerId')::uuid,(e->>'variantId')::uuid,e->>'fieldPath',e->'value',e->>'sourceUrl',e->>'sourceKind',e->>'extractionMethod',e->>'evidenceExcerpt',e->>'contentSha256',(e->>'observedAt')::timestamptz,e->>'confidence',e->>'extractorVersion');
    if e->>'fieldPath'='/itemPrice' and price is not null then
      update offers set price_evidence_id=(e->>'id')::uuid where id=(c->>'offerId')::uuid;
      insert into price_observations(search_id,offer_id,observed_at,item_price,shipping_fee,conditional_prices,currency,evidence_id,extractor_version)
        values(p_search,(c->>'offerId')::uuid,(c->>'priceObservedAt')::timestamptz,price,shipping,c->'conditionalPrices','KRW',(e->>'id')::uuid,e->>'extractorVersion');
    end if;
    if e->>'fieldPath'='/shippingFee' then update offers set shipping_evidence_id=(e->>'id')::uuid where id=(c->>'offerId')::uuid; end if;
    if e->>'fieldPath'='/imageUrl' then
      insert into product_images(search_id,product_id,variant_id,image_url,image_url_hash,source_url,image_source,extraction_stage,verified_same_product,is_merchant_image,image_observed_at,evidence_id)
        values(p_search,(c->>'productId')::uuid,(c->>'variantId')::uuid,c->>'imageUrl',c->>'imageHash',c->>'imageSourceUrl',c->>'imageSource',c->>'imageExtractionStage',true,true,(c->>'imageObservedAt')::timestamptz,(e->>'id')::uuid);
    end if;
  end loop;
  update search_candidates set product_id=(c->>'productId')::uuid,snapshot=c,metadata_status='VERIFIED',image_status='VERIFIED',price_status=case when price is null then 'UNKNOWN' else 'VERIFIED' end
    where id=(c->>'candidateId')::uuid and search_id=p_search;
end $$;

create table public.source_leases(host text primary key,token uuid not null,expires_at timestamptz not null);
alter table public.source_leases enable row level security;
revoke all on public.source_leases from anon,authenticated;
grant all on public.source_leases to service_role;
create function public.claim_source(p_job bigint,p_token uuid,p_attempt integer,p_host text) returns uuid language plpgsql security definer set search_path=public as $$
declare tok uuid:=gen_random_uuid(); begin
  perform pg_advisory_xact_lock(8453001);perform assert_lease(p_job,p_token,p_attempt);
  delete from source_leases where expires_at<=now();
  if exists(select 1 from source_leases where host=p_host) or(select count(*) from source_leases)>=4 then return null; end if;
  insert into source_leases(host,token,expires_at) values(p_host,tok,now()+interval '18 seconds');return tok;
end $$;

create function public.complete_cleanup(p_id bigint) returns void language plpgsql security definer set search_path=public as $$
declare c cleanup_tasks; begin
  select * into c from cleanup_tasks where id=p_id for update;
  if c.id is null or c.state='DONE' then return; end if;
  update upload_sessions set object_key=null,raw_sha256=null,status='DELETED',lease_token=null,lease_expires_at=null where id=c.upload_id;
  update cleanup_tasks set state='DONE',object_key=null,owner_id=null,search_id=null,upload_id=null,completed_at=now() where id=c.id;
end $$;
create function public.claim_cleanup() returns setof public.cleanup_tasks language sql security definer set search_path=public as $$
  with picked as(select id from cleanup_tasks where state<>'DONE' and available_at<=now() order by available_at,id for update skip locked limit 20)
  update cleanup_tasks c set state='LEASED',attempt=attempt+1,available_at=now()+interval '1 minute' from picked where c.id=picked.id returning c.*;
$$;

create function public.terminal_is_final() returns trigger language plpgsql set search_path=public as $$ begin
  if old.status not in ('QUEUED','RUNNING') and new.status<>old.status then raise exception 'TERMINAL_STATE_IMMUTABLE'; end if;return new;
end $$;
create trigger run_terminal_guard before update on public.search_runs for each row execute function public.terminal_is_final();
create function public.immutable_snapshot() returns trigger language plpgsql set search_path=public as $$ begin raise exception 'SNAPSHOT_IMMUTABLE'; end $$;
create trigger snapshot_immutable before update on public.search_rank_snapshots for each row execute function public.immutable_snapshot();
create trigger observation_immutable before update on public.price_observations for each row execute function public.immutable_snapshot();

-- Recovery may publish an already compared, evidence-backed snapshot after the deadline.
-- It does not acquire a lease or start any provider call. Late workers remain fenced.
create function public.recover_terminal(p_search uuid,p_payload jsonb) returns void language plpgsql security definer set search_path=public as $$
declare r search_runs; item jsonb; has_results boolean; begin
  perform 1 from pilot_budget where id=true for update;
  select * into r from search_runs where id=p_search and deleted_at is null and status in ('QUEUED','RUNNING') for update;
  if r.id is null then return; end if;
  if r.deadline_at>now() and not exists(select 1 from search_jobs where search_id=r.id and state='LEASED' and lease_expires_at<=now() and attempt>=max_attempts) then return; end if;
  if jsonb_array_length(p_payload->'eligible')>(case when r.mode='IMAGE_SIMILAR' then 20 else 30 end) then raise exception 'CANDIDATE_CAP'; end if;
  has_results:=jsonb_array_length(p_payload->'eligible')>0;
  insert into search_rank_snapshots(search_id,eligible,references_json,sort_orders,versions) values(r.id,p_payload->'eligible',p_payload->'references',p_payload->'sortOrders',r.versions);
  for item in select value from jsonb_array_elements(p_payload->'results') loop
    insert into search_results(search_id,product_id,offer_id,mode,kind,price_basis,cohort_rank,final_score,deal_relevance,snapshot)
      values(r.id,(item->>'productId')::uuid,(item->>'offerId')::uuid,r.mode,'RECOMMENDATION',item->>'priceBasis',(item->>'cohortRank')::smallint,(item->>'finalScore')::numeric,(item->>'dealRelevance')::numeric,item);
  end loop;
  update search_runs set status=case when has_results then 'PARTIAL' when deadline_at<=now() then 'EXPIRED' else 'FAILED' end,completed_at=now(),
    warning_codes=warning_codes||'[{"code":"DEADLINE_EXCEEDED","message":"처리 시간 안에 확인한 상품만 보여드려요."}]'::jsonb,
    failure=case when has_results then null else '{"code":"DEADLINE_EXCEEDED","message":"검색을 완료하지 못했어요.","retryable":true}'::jsonb end where id=r.id;
  update search_jobs set state='CANCELED',lease_token=null,lease_expires_at=null where search_id=r.id and state in ('READY','LEASED');
  update provider_runs set status='UNCERTAIN',error_code='WORKER_INTERRUPTED' where search_id=r.id and status='STARTED';
  perform queue_input_cleanup(r.id,true);perform close_search_budget(r.id);
end $$;

do $$ declare f record; begin
  for f in select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on p.pronamespace=n.oid where n.nspname='public' and p.prosecdef loop
    execute format('revoke all on function %s from public,anon,authenticated',f.sig);execute format('grant execute on function %s to service_role',f.sig);
  end loop;
end $$;
