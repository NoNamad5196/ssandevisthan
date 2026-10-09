import {hash,assertDatabaseCompatibility} from './release.mjs';
// Minimum operational metadata. Upload bytes/keys, job checkpoints, credentials,
// anonymous-session tokens, rate IP hashes and operational logs are excluded.
const children=['search_queries','products','product_variants','offers','product_images','search_candidates','field_evidence','price_observations','search_results','search_rank_snapshots','provider_runs'];
const terminal=new Set(['COMPLETED','PARTIAL','NO_RELIABLE_MATCH','FAILED','CANCELED','EXPIRED']);
function assertNoSensitivePayload(value){
 const serialized=JSON.stringify(value);
 if(/data:image\/|Bearer\s+[A-Za-z0-9._-]+|sk-(?:proj-)?[A-Za-z0-9_-]{16}|[?&](?:x-amz-signature|access_token|signature|api_key)=/i.test(serialized))throw Error('RECOVERY_SENSITIVE_PAYLOAD_REJECTED');
 const walk=v=>{if(!v||typeof v!=='object')return;for(const [key,item] of Object.entries(v)){if(/^(?:access_token|accessToken|refresh_token|refreshToken|secret|api_key|OPENAI_API_KEY|raw_image|rawBytes|prompt|authorization)$/i.test(key))throw Error('RECOVERY_SENSITIVE_PAYLOAD_REJECTED');walk(item);}};walk(value);
}
export async function exportRecoverySnapshot(client,now=new Date()){
 await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');try{
  const query=async(sql,params=[])=>(await client.query(sql,params)).rows;
  const runs=await query('SELECT * FROM public.search_runs WHERE deleted_at IS NULL AND expires_at>$1 ORDER BY id',[now.toISOString()]);
  const ids=runs.map(r=>r.id),owners=[...new Set(runs.map(r=>r.owner_id))],tables={search_runs:runs};
  tables['auth.users']=await query('SELECT id,created_at FROM auth.users WHERE id=ANY($1::uuid[]) ORDER BY id',[owners]);
  tables.search_idempotency=(await query('SELECT * FROM public.search_idempotency WHERE expires_at>$1 AND owner_id=ANY($2::uuid[])',[now.toISOString(),owners])).filter(r=>!r.search_id||ids.includes(r.search_id)).map(r=>({...r}));
  for(const table of children)tables[table]=await query(`SELECT * FROM public.${table} WHERE search_id=ANY($1::uuid[])`,[ids]);
  const budget=(await query('SELECT * FROM public.pilot_budget WHERE id=true'))[0];
  const reservations=(await query('SELECT * FROM public.budget_reservations ORDER BY id')).map(r=>({...r,search_id:ids.includes(r.search_id)?r.search_id:null}));
  const migrations=await query('SELECT name,sha256 FROM public.deployment_migrations ORDER BY name');
  const earliest=Math.min(now.getTime()+3600000,...runs.map(r=>new Date(r.expires_at).getTime()));
  const payload={schemaVersion:1,createdAt:now.toISOString(),expiresAt:new Date(earliest).toISOString(),migrations,tables,budget,reservations,policy:'metadata-only-no-images-no-session-secrets-v1'};
  assertNoSensitivePayload(payload);await client.query('COMMIT');return{sha256:hash(JSON.stringify(payload)),payload};
 }catch(e){await client.query('ROLLBACK');throw e;}
}
export async function restoreRecoverySnapshot(client,envelope,now=new Date()){
 if(envelope?.payload?.schemaVersion!==1||hash(JSON.stringify(envelope.payload))!==envelope.sha256)throw Error('RECOVERY_CHECKSUM_MISMATCH');
 const p=envelope.payload;assertNoSensitivePayload(p);
 if(!Number.isFinite(Date.parse(p.expiresAt))||Date.parse(p.expiresAt)<=now.getTime())throw Error('RECOVERY_EXPORT_EXPIRED');
 await client.query('BEGIN');try{
  await client.query('SELECT pg_advisory_xact_lock(8453006)');
  const migrations=(await client.query('SELECT name,sha256 FROM public.deployment_migrations ORDER BY name')).rows;assertDatabaseCompatibility(p.migrations,migrations);
  const emptyTables=['auth.users','auth.anonymous_sessions','auth.creation_events','public.search_runs','public.upload_sessions','public.search_jobs','public.budget_reservations','public.search_idempotency','public.cleanup_tasks','public.request_rate_events','public.source_leases','public.schedule_ticks',...children.map(t=>'public.'+t)];
  for(const table of emptyTables)if(Number((await client.query(`SELECT count(*) n FROM ${table}`)).rows[0].n)!==0)throw Error('RESTORE_TARGET_NOT_EMPTY');
  const existing=(await client.query('SELECT * FROM public.pilot_budget WHERE id=true FOR UPDATE')).rows[0];
  if(existing.enabled||Number(existing.spent_microusd)!==0||existing.history_verified_at)throw Error('RESTORE_TARGET_NOT_EMPTY');
  const insert=async(table,row)=>{await client.query(`INSERT INTO ${table} SELECT * FROM jsonb_populate_record(NULL::${table},$1::jsonb)`,[JSON.stringify(row)]);};
  // Keep known spend and all uncertain reservations, but require post-loss
  // reconciliation. A stale backup cannot prove that later provider calls were free.
  const budget={...p.budget,enabled:false,history_verified_at:null,model_verified_at:null,rates_verified_at:null,free_quota_verified_at:null,updated_at:now.toISOString()};
  await client.query(`UPDATE public.pilot_budget SET ceiling_microusd=$1,spent_microusd=$2,enabled=false,history_verified_at=null,model_verified_at=null,rates_verified_at=null,free_quota_verified_at=null,rates=$3,search_ceiling_microusd=$4,minimum_search_reservation_microusd=$5,updated_at=$6`,[budget.ceiling_microusd,budget.spent_microusd,JSON.stringify(budget.rates),budget.search_ceiling_microusd,budget.minimum_search_reservation_microusd,budget.updated_at]);
  const valid=p.tables.search_runs.filter(r=>!r.deleted_at&&Date.parse(r.expires_at)>now.getTime()),ids=new Set(valid.map(r=>r.id)),owners=new Set(valid.map(r=>r.owner_id));
  for(const row of p.tables['auth.users'])if(owners.has(row.id))await insert('auth.users',row);
  for(const row of valid){const restored={...row,upload_id:null};if(!terminal.has(row.status))Object.assign(restored,{status:'FAILED',completed_at:now.toISOString(),failure:{code:'OPERATOR_STOP',message:'복구 후 이미지를 다시 업로드해 주세요.',retryable:true}});await insert('public.search_runs',restored);}
  for(const row of p.tables.search_idempotency)if(owners.has(row.owner_id)&&Date.parse(row.expires_at)>now.getTime())await insert('public.search_idempotency',{...row,search_id:ids.has(row.search_id)?row.search_id:null});
  for(const table of children)for(const row of p.tables[table])if(ids.has(row.search_id))await insert('public.'+table,table==='provider_runs'&&row.status==='STARTED'?{...row,status:'UNCERTAIN',error_code:'OPERATOR_STOP'}:row);
  for(const row of p.reservations)await insert('public.budget_reservations',{...row,search_id:ids.has(row.search_id)?row.search_id:null});
  // No jobs or uploads are imported, so neither old leases nor images can revive.
  await client.query('COMMIT');return{restoredSearches:valid.length,interruptedSearches:valid.filter(r=>!terminal.has(r.status)).length,reservations:p.reservations.length,paidExecutionEnabled:false};
 }catch(e){await client.query('ROLLBACK');throw e;}
}
