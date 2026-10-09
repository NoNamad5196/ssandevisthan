import {beforeAll,afterAll,describe,it,expect} from 'vitest';
import {PGlite} from '@electric-sql/pglite';
import {pgcrypto} from '@electric-sql/pglite/contrib/pgcrypto';
import {readFile,readdir} from 'node:fs/promises';

// Actual PostgreSQL execution in WASM. Auth and Storage schemas below are explicit
// test harness substitutes; production Supabase runtime/network is not simulated as LIVE.
describe('v3 PostgreSQL migrations and guarded transactions (local PostgreSQL)',()=>{
  let db:PGlite;
  const ownerA='11111111-1111-4111-8111-111111111111',ownerB='22222222-2222-4222-8222-222222222222';
  beforeAll(async()=>{
    db=new PGlite({extensions:{pgcrypto}});await db.waitReady;
    await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
      create schema auth; create schema storage; create schema extensions;
      create table auth.users(id uuid primary key);
      create function auth.uid() returns uuid language sql as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
      grant usage on schema auth to authenticated; grant execute on function auth.uid() to authenticated;
      create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
      insert into auth.users(id) values('${ownerA}'),('${ownerB}');`);
    const directory=new URL('../migrations/',import.meta.url);
    for(const file of (await readdir(directory)).filter(f=>f.endsWith('.sql')).sort()){
      const sql=await readFile(new URL(file,directory),'utf8');
      try{await db.exec(sql);}catch(e:any){throw new Error(`${file}: ${e.message}; position=${e.position}; internal=${e.internalPosition}; context=${e.where}; SQL=${sql.slice(Math.max(0,Number(e.position)-160),Number(e.position)+160)}`);}
    }
    await db.exec(`update public.pilot_budget set enabled=true,history_verified_at=now(),rates_verified_at=now(),model_verified_at=now(),free_quota_verified_at=now(),rates='{}',search_ceiling_microusd=1000000,minimum_search_reservation_microusd=100000;`);
  },60000);
  afterAll(async()=>{await db?.close();});
  async function upload(owner=ownerA){
    const id=crypto.randomUUID();await db.query(`insert into upload_sessions(id,owner_id,status,declared_mime,declared_bytes,object_key,normalized_sha256,normalizer_version,width,height,normalized_bytes)
      values($1,$2,'READY','image/png',100,$3,$4,'fixture-only',16,16,50)`,[id,owner,`${owner}/${id}/normalized.webp`,'a'.repeat(64)]);return id;
  }
  async function accept(id:string,key=crypto.randomUUID(),owner=ownerA,limit=10){
    const input={schemaVersion:3,uploadId:id,resultLimit:limit};
    const response=await db.query<{r:any}>('select accept_search($1,$2,$3,$4,$5,$6) r',[owner,key,'IMAGE_SIMILAR',JSON.stringify(input),'{}','test-ip']);
    return{...response.rows[0]!.r,key,input};
  }
  async function cancel(id:string,owner=ownerA){await db.query('select cancel_search($1,$2)',[owner,id]);}
  async function count(table:string){return Number((await db.query<{n:string}>(`select count(*) n from ${table}`)).rows[0]!.n);}
  it('all user and internal tables have RLS, normalized bucket private, RPCs not executable by clients',async()=>{
    const rows=await db.query<{relname:string;relrowsecurity:boolean}>(`select relname,relrowsecurity from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and relkind='r'`);
    expect(rows.rows.length).toBeGreaterThanOrEqual(19);expect(rows.rows.every(r=>r.relrowsecurity)).toBe(true);
    expect((await db.query<{public:boolean}>('select public from storage.buckets')).rows[0]!.public).toBe(false);
    expect((await db.query<{ok:boolean}>(`select has_function_privilege('authenticated','public.claim_search_job()','execute') ok`)).rows[0]!.ok).toBe(false);
  });
  it('response-loss retry reuses run and single reservation; changed input rejects',async()=>{
    const id=await upload(),a=await accept(id),b=await accept(id,a.key);
    expect(a.reused).toBe(false);expect(b.reused).toBe(true);expect(a.run.id).toBe(b.run.id);
    expect(Number((await db.query<{n:string}>(`select count(*) n from search_jobs where search_id=$1`,[a.run.id])).rows[0]!.n)).toBe(1);
    await expect(accept(id,a.key,ownerA,9)).rejects.toThrow('IDEMPOTENCY_KEY_REUSED');
    await cancel(a.run.id);
  });
  it('database enforces owner RLS and cross-user cancel yields identical not-found',async()=>{
    const a=await accept(await upload());await expect(cancel(a.run.id,ownerB)).rejects.toThrow('NOT_FOUND');
    await db.exec('begin; set local role authenticated;');
    try{await db.query(`select set_config('request.jwt.claim.sub',$1,true)`,[ownerB]);expect((await db.query('select id from search_runs where id=$1',[a.run.id])).rows).toHaveLength(0);
      await db.query(`select set_config('request.jwt.claim.sub',$1,true)`,[ownerA]);expect((await db.query('select id from search_runs where id=$1',[a.run.id])).rows).toHaveLength(1);
    }finally{await db.exec('rollback;');}await cancel(a.run.id);
  });
  it('invalid result limit rolls back run, upload consumption, and reservation together',async()=>{
    const id=await upload(),before=await count('search_runs'),reservations=await count('budget_reservations');
    await expect(accept(id,crypto.randomUUID(),ownerA,0)).rejects.toThrow();expect(await count('search_runs')).toBe(before);expect(await count('budget_reservations')).toBe(reservations);
    expect((await db.query<{status:string}>('select status from upload_sessions where id=$1',[id])).rows[0]!.status).toBe('READY');
  });
  it('cancel invalidates leased worker and preserves uncertain external charge',async()=>{
    const a=await accept(await upload());const claim=(await db.query<any>('select * from claim_search_job()')).rows[0]!;
    expect(claim.search_id).toBe(a.run.id);
    await db.query('select reserve_provider($1,$2,$3,$4,$5,$6)',[claim.id,claim.lease_token,claim.attempt,'analysis','analysis:1',100000]);
    await cancel(a.run.id);
    await expect(db.query('select assert_lease($1,$2,$3)',[claim.id,claim.lease_token,claim.attempt])).rejects.toThrow('LEASE_LOST');
    const reservation=(await db.query<any>(`select * from budget_reservations where search_id=$1 and operation_key='SEARCH'`,[a.run.id])).rows[0]!;
    expect(reservation.state).toBe('RESERVED');
    await db.query('select settle_provider($1,$2,$3,$4,$5,$6,$7)',[a.run.id,'analysis:1',50000,'{}','fixture-request',10,null]);
    await db.query('select close_search_budget($1)',[a.run.id]);await db.query('select close_search_budget($1)',[a.run.id]);
    expect(Number((await db.query<any>('select spent_microusd from pilot_budget')).rows[0]!.spent_microusd)).toBe(50000);
    await expect(db.query(`update search_runs set status='RUNNING' where id=$1`,[a.run.id])).rejects.toThrow('TERMINAL_STATE_IMMUTABLE');
  });
  it('deletion tombstone blocks late retry and private object key survives run cleanup',async()=>{
    const a=await accept(await upload());await db.query('select delete_search($1,$2)',[ownerA,a.run.id]);
    await expect(accept(a.input.uploadId,a.key)).rejects.toThrow('SEARCH_DELETED');
    await db.query('select sweep_searches()');expect((await db.query('select id from search_runs where id=$1',[a.run.id])).rows).toHaveLength(0);
    expect((await db.query<any>('select object_key from cleanup_tasks where search_id=$1',[a.run.id])).rows[0]!.object_key).toContain('normalized.webp');
  });
  it('unknown historical spend or exhausted balance rejects before any run is created',async()=>{
    await db.exec(`delete from request_rate_events; update pilot_budget set history_verified_at=null;`);const before=await count('search_runs');
    await expect(accept(await upload())).rejects.toThrow('TEMPORARILY_UNAVAILABLE');expect(await count('search_runs')).toBe(before);
    await db.exec(`update pilot_budget set history_verified_at=now(),spent_microusd=19999999;`);
    await expect(accept(await upload())).rejects.toThrow('BUDGET_LIMITED');expect(await count('search_runs')).toBe(before);
  });
  it('an unverified admission floor blocks before consuming an upload',async()=>{
    await db.exec(`delete from request_rate_events; update pilot_budget set spent_microusd=50000,minimum_search_reservation_microusd=null;`);
    const id=await upload(),before=await count('search_runs');
    await expect(accept(id)).rejects.toThrow('TEMPORARILY_UNAVAILABLE');expect(await count('search_runs')).toBe(before);
    expect((await db.query<any>('select status from upload_sessions where id=$1',[id])).rows[0]!.status).toBe('READY');
    await db.exec(`update pilot_budget set minimum_search_reservation_microusd=11000000,search_ceiling_microusd=20000000;`);
  });
  it('reserves remaining cumulative balance and serializes competing admissions without double allocation',async()=>{
    const idA=await upload(),idB=await upload(ownerB);
    const results=await Promise.allSettled([accept(idA),accept(idB,crypto.randomUUID(),ownerB)]);
    expect(results.filter(r=>r.status==='fulfilled')).toHaveLength(1);
    const rejected=results.find(r=>r.status==='rejected') as PromiseRejectedResult;expect(rejected.reason.message).toContain('BUDGET_LIMITED');
    const a=(results.find(r=>r.status==='fulfilled') as PromiseFulfilledResult<any>).value;
    const top=(await db.query<any>(`select * from budget_reservations where search_id=$1 and operation_key='SEARCH'`,[a.run.id])).rows[0]!;
    expect(Number(top.reserved_microusd)).toBe(19950000);
    // Response-loss retries still return the accepted run even if admission is subsequently disabled.
    await db.exec('update pilot_budget set enabled=false;');
    const retry=await accept(a.input.uploadId,a.key,a.run.owner_id);expect(retry.reused).toBe(true);expect(retry.run.id).toBe(a.run.id);
    await db.exec('update pilot_budget set enabled=true;');await cancel(a.run.id,a.run.owner_id);
  });
  it('durable settlement releases child headroom while unknown outcomes retain their entire escrow',async()=>{
    await db.exec('delete from request_rate_events;');const a=await accept(await upload());
    const first=(await db.query<any>('select * from claim_search_job()')).rows[0]!;
    await db.query('select reserve_provider($1,$2,$3,$4,$5,$6)',[first.id,first.lease_token,first.attempt,'discovery','discovery:1',11000000]);
    await expect(db.query('select reserve_provider($1,$2,$3,$4,$5,$6)',[first.id,first.lease_token,first.attempt,'discovery','discovery:2',11000000])).rejects.toThrow('BUDGET_LIMITED');
    const settlement={p_search:a.run.id,p_key:'discovery:1',p_actual:25000,p_units:{fixture:true},p_request_id:'fixture-known',p_latency:1,p_error:null};
    await db.query('select commit_search_step($1,$2,$3,$4)',[first.id,first.lease_token,first.attempt,JSON.stringify({settlements:[settlement],nextJobs:[{key:'discovery:next',stage:'DISCOVERING'}]})]);
    const second=(await db.query<any>('select * from claim_search_job()')).rows[0]!;
    expect(second.operation_key).toBe('discovery:next');
    await db.query('select reserve_provider($1,$2,$3,$4,$5,$6)',[second.id,second.lease_token,second.attempt,'discovery','discovery:2',11000000]);
    await db.query('select settle_provider($1,$2,$3,$4,$5,$6,$7)',[a.run.id,'discovery:2',null,'{}','fixture-unknown',1,'PROVIDER_TIMEOUT']);
    await expect(db.query('select reserve_provider($1,$2,$3,$4,$5,$6)',[second.id,second.lease_token,second.attempt,'discovery','discovery:2',11000000])).rejects.toThrow('PROVIDER_OUTCOME_UNKNOWN');
    await expect(db.query('select reserve_provider($1,$2,$3,$4,$5,$6)',[second.id,second.lease_token,second.attempt,'discovery','discovery:3',11000000])).rejects.toThrow('BUDGET_LIMITED');
    await cancel(a.run.id);
    expect((await db.query<any>(`select state from budget_reservations where search_id=$1 and operation_key='SEARCH'`,[a.run.id])).rows[0]!.state).toBe('RESERVED');
    await expect(accept(await upload(ownerB),crypto.randomUUID(),ownerB)).rejects.toThrow('BUDGET_LIMITED');
    // Explicit known fixture reconciliation releases exactly once; no automatic refund.
    await db.query('select settle_provider($1,$2,$3,$4,$5,$6,$7)',[a.run.id,'discovery:2',30000,'{}','fixture-reconciled',1,null]);
    await db.query('select close_search_budget($1)',[a.run.id]);await db.query('select close_search_budget($1)',[a.run.id]);
    expect(Number((await db.query<any>('select spent_microusd from pilot_budget')).rows[0]!.spent_microusd)).toBe(105000);
  });
});
