-- Admission caps protect free storage and bounded image decoder memory.
create function public.create_upload(p_owner uuid,p_mime text,p_bytes bigint) returns jsonb
language plpgsql security definer set search_path=public as $$
declare u upload_sessions; begin
  perform pg_advisory_xact_lock(8453004);
  if (select count(*) from upload_sessions where owner_id=p_owner and expires_at>now() and deleted_at is null and status not in ('DELETED','EXPIRED'))>=10
    or (select count(*) from upload_sessions where expires_at>now() and deleted_at is null and status not in ('DELETED','EXPIRED'))>=100 then raise exception 'RATE_LIMITED'; end if;
  insert into upload_sessions(owner_id,declared_mime,declared_bytes) values(p_owner,p_mime,p_bytes) returning * into u;
  return to_jsonb(u);
end $$;
create or replace function public.claim_upload(p_owner uuid,p_upload uuid,p_raw_hash text) returns jsonb
language plpgsql security definer set search_path=public as $$
declare u upload_sessions; begin
  perform pg_advisory_xact_lock(8453005);
  select * into u from upload_sessions where id=p_upload and owner_id=p_owner and deleted_at is null for update;
  if u.id is null then raise exception 'NOT_FOUND'; end if;
  if u.expires_at<=now() then raise exception 'UPLOAD_EXPIRED'; end if;
  if u.raw_sha256 is not null and u.raw_sha256<>p_raw_hash then raise exception 'UPLOAD_CONTENT_CHANGED'; end if;
  if u.status in ('STORED','READY') then return to_jsonb(u); end if;
  if u.status='CONSUMED' then raise exception 'UPLOAD_ALREADY_CONSUMED'; end if;
  if u.status='PROCESSING' and u.lease_expires_at>now() then raise exception 'UPLOAD_PROCESSING'; end if;
  if (select count(*) from upload_sessions where status='PROCESSING' and lease_expires_at>now())>=2 then raise exception 'RATE_LIMITED'; end if;
  update upload_sessions set status='PROCESSING',object_key=p_owner::text||'/'||p_upload::text||'/normalized.webp',raw_sha256=p_raw_hash,
    lease_token=gen_random_uuid(),lease_expires_at=now()+interval '20 seconds' where id=u.id returning * into u;
  return to_jsonb(u);
end $$;
revoke all on function public.create_upload(uuid,text,bigint),public.claim_upload(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.create_upload(uuid,text,bigint),public.claim_upload(uuid,uuid,text) to service_role;
