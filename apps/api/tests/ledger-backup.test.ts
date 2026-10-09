import {afterAll,beforeAll,describe,expect,it,vi} from 'vitest';
import {PGlite} from '@electric-sql/pglite';
import {pgcrypto} from '@electric-sql/pglite/contrib/pgcrypto';
import {createHash,randomUUID} from 'node:crypto';
import {exportLedgerSnapshot,restoreLedgerSnapshot,validateLedgerSnapshot,LEDGER_POLICY,type LedgerEnvelope} from '../../../deploy/neon/ledger.mjs';
import {ledgerExpiry,storeLedgerSnapshot,sweepLedgerBackups,LEDGER_PREFIX} from '../../../deploy/neon/ledger-storage.mjs';
import {validateLedgerDestination} from '../../../deploy/neon/backup.mjs';
import {PRODUCTION_TARGET} from '../../../deploy/neon/target.mjs';

const migrationPath='../../../deploy/neon/migrate.mjs';
const digest=(p:unknown)=>createHash('sha256').update(JSON.stringify(p)).digest('hex');
const now=new Date();
function envelope():LedgerEnvelope{const payload={schemaVersion:1 as const,policy:LEDGER_POLICY,createdAt:now.toISOString(),expiresAt:new Date(now.getTime()+3600000).toISOString(),migrations:[{name:'deploy/neon/000_bootstrap.sql',sha256:'a'.repeat(64)}],budget:{ceilingMicrousd:20000000,spentMicrousd:123456},holds:{parentCount:2,parentMicrousd:10900000,unattributedChildCount:1,unattributedChildMicrousd:100000}};return{payload,sha256:digest(payload)};}
const objectKey=(expires=now.getTime()+3600000)=>`${LEDGER_PREFIX}${expires}/${randomUUID()}.json`;
const signed=(p:any)=>({payload:p,sha256:digest(p)});

describe('minimal private operational ledger envelope',()=>{
 it('has strict aggregate-only vocabulary and bounded TTL',()=>{expect(validateLedgerSnapshot(envelope(),now)).toEqual(envelope());expect(Buffer.byteLength(JSON.stringify(envelope()))).toBeLessThan(32768);});
 it.each(['owner_id','search_id','query','prompt','raw_image','accessToken','refreshToken'])('rejects the extra field %s even with a valid checksum',key=>{const p:any=envelope().payload;p[key]='synthetic must never be exported';expect(()=>validateLedgerSnapshot(signed(p),now)).toThrow('LEDGER_ENVELOPE_INVALID');});
 it('rejects altered values, oversized objects and integer overflow',()=>{
  const e=envelope();e.payload.budget.spentMicrousd=0;expect(()=>validateLedgerSnapshot(e,now)).toThrow('LEDGER_CHECKSUM_MISMATCH');
  expect(()=>validateLedgerSnapshot({...envelope(),extra:'x'.repeat(32768)},now)).toThrow('LEDGER_ENVELOPE_INVALID');
  const p=envelope().payload;p.holds.parentMicrousd=Number.MAX_SAFE_INTEGER;p.holds.unattributedChildMicrousd=1;expect(()=>validateLedgerSnapshot(signed(p),now)).toThrow('LEDGER_AMOUNT_INVALID');
 });
 it('rejects expired, future, overlong or noncanonical timestamps',()=>{
  expect(()=>validateLedgerSnapshot(envelope(),new Date(now.getTime()+3600000))).toThrow('LEDGER_EXPIRED');
  for(const update of [{createdAt:new Date(now.getTime()+6000).toISOString()},{expiresAt:new Date(now.getTime()+3600001).toISOString()},{createdAt:'2026-10-09'}])expect(()=>validateLedgerSnapshot(signed({...envelope().payload,...update}),now)).toThrow('LEDGER_TIME_INVALID');
 });
 it('refuses arbitrary migration payloads and duplicate migration identities',()=>{
  const p=envelope().payload;p.migrations.push({...p.migrations[0]});expect(()=>validateLedgerSnapshot(signed(p),now)).toThrow('LEDGER_MIGRATIONS_INVALID');
  p.migrations=[{name:'../../sensitive',sha256:'a'.repeat(64)}];expect(()=>validateLedgerSnapshot(signed(p),now)).toThrow('LEDGER_MIGRATIONS_INVALID');
 });
});

describe('actual PostgreSQL aggregate export and ledger-only restore',()=>{
 const databases:PGlite[]=[];let source:any,target:any,empty:any,snapshot:LedgerEnvelope;const queries:string[]=[];
 const owner=randomUUID(),search=randomUUID();
 beforeAll(async()=>{
  const {applyMigrations}=await import(migrationPath);
  async function db(){const db=new PGlite({extensions:{pgcrypto}});databases.push(db);await db.waitReady;const c={async query(sql:string,params:unknown[]=[]){if(params.length)return db.query(sql,params);return(await db.exec(sql)).at(-1)??{rows:[]};}};await applyMigrations(c);return c;}
  [source,target,empty]=await Promise.all([db(),db(),db()]);
  await source.query('INSERT INTO auth.users(id) VALUES($1)',[owner]);
  await source.query(`INSERT INTO public.search_runs(id,owner_id,mode,input_digest,input_descriptor,versions) VALUES($1,$2,'DEAL_TEXT','synthetic-digest','{"privateQuery":"synthetic-user-query-must-not-export"}','{}')`,[search,owner]);
  await source.query('UPDATE public.pilot_budget SET spent_microusd=123456');
  await source.query(`INSERT INTO public.budget_reservations(search_id,operation_key,reserved_microusd,state) VALUES($1,'SEARCH',10000000,'RESERVED'),($1,'analysis:1',7000000,'RESERVED'),(null,'SEARCH',900000,'RESERVED'),(null,'discovery:1',100000,'RESERVED')`,[search]);
  snapshot=await exportLedgerSnapshot({query(sql,params){queries.push(sql);return source.query(sql,params);}},now);
 },30000);
 afterAll(async()=>{for(const db of databases)await db.close();});
 it('exports no user/search values and never reads their tables',()=>{
  expect(snapshot.payload.holds).toEqual({parentCount:2,parentMicrousd:10900000,unattributedChildCount:1,unattributedChildMicrousd:100000});
  const serialized=JSON.stringify(snapshot);for(const forbidden of [owner,search,'synthetic-user-query','analysis:1','discovery:1'])expect(serialized).not.toContain(forbidden);
  expect(queries.join('\n')).not.toMatch(/FROM (?:auth\.|public\.(?:search|provider|upload))/i);
 });
 it('preserves spend and unknown hold, restores zero users/jobs/results and disables all verification',async()=>{
  expect(await restoreLedgerSnapshot(target,snapshot,now)).toEqual({paidExecutionEnabled:false,spentMicrousd:123456,heldMicrousd:11000000,searchesRestored:0,reconciliationRequired:true});
  const b=(await target.query('SELECT * FROM public.pilot_budget')).rows[0];expect(Number(b.spent_microusd)).toBe(123456);expect(b.enabled).toBe(false);
  for(const key of ['history_verified_at','model_verified_at','rates_verified_at','free_quota_verified_at','rates','minimum_search_reservation_microusd'])expect(b[key]).toBeNull();
  const r=(await target.query('SELECT * FROM public.budget_reservations')).rows[0];expect(r.search_id).toBeNull();expect(r.operation_key).toBe('SEARCH');expect(Number(r.reserved_microusd)).toBe(11000000);
  for(const table of ['auth.users','public.search_runs','public.search_jobs','public.search_results'])expect(Number((await target.query(`SELECT count(*) n FROM ${table}`)).rows[0].n)).toBe(0);
  await target.query('SELECT close_search_budget($1)',[randomUUID()]);expect((await target.query('SELECT state FROM public.budget_reservations')).rows[0].state).toBe('RESERVED');
  await expect(restoreLedgerSnapshot(target,snapshot,now)).rejects.toThrow('LEDGER_TARGET_NOT_EMPTY');
 });
 it('rejects nonempty application, expired envelope and schema mismatch before restoring',async()=>{
  await expect(restoreLedgerSnapshot(source,snapshot,now)).rejects.toThrow('LEDGER_TARGET_NOT_EMPTY');
  await expect(restoreLedgerSnapshot(empty,snapshot,new Date(now.getTime()+3600000))).rejects.toThrow('LEDGER_EXPIRED');
  const changed=structuredClone(snapshot.payload);changed.migrations[0].sha256='b'.repeat(64);await expect(restoreLedgerSnapshot(empty,signed(changed),now)).rejects.toThrow('LEDGER_SCHEMA_MISMATCH');
  expect(Number((await empty.query('SELECT spent_microusd FROM public.pilot_budget')).rows[0].spent_microusd)).toBe(0);
 });
 it('zero-spend/zero-hold restore still leaves an idempotency marker and cannot be replayed',async()=>{
  const p=structuredClone(snapshot.payload);p.budget.spentMicrousd=0;p.holds={parentCount:0,parentMicrousd:0,unattributedChildCount:0,unattributedChildMicrousd:0};
  expect((await restoreLedgerSnapshot(empty,signed(p),now)).heldMicrousd).toBe(0);
  await expect(restoreLedgerSnapshot(empty,signed(p),now)).rejects.toThrow('LEDGER_TARGET_NOT_EMPTY');
 });
});

describe('bounded manual writer and DB-free scheduled expiry (mock S3)',()=>{
 function setup(contents:any[]=[],truncated=false){const commands:any[]=[],events:any[]=[];const s3={send:vi.fn(async(command:any)=>{commands.push(command);return command.constructor.name==='ListObjectsV2Command'?{Contents:contents,IsTruncated:truncated}:{};})};const client={query:vi.fn(async(sql:string)=>({rows:[{locked:!sql.includes('unlock')}]}))};const audit=(event:string,fields:any)=>events.push({event,...fields});return{s3,client,commands,events,audit};}
 it('writes only a new private immutable key under a session lock, then releases it',async()=>{
  const s=setup();const result=await storeLedgerSnapshot(s.client,s.s3,'private-test',{now,factory:async()=>envelope()});expect(ledgerExpiry(result.key)).toBe(now.getTime()+3600000);
  expect(s.commands[1].input).toMatchObject({Bucket:'private-test',ContentType:'application/json',CacheControl:'private, no-store',IfNoneMatch:'*'});expect(s.client.query.mock.calls[0][0]).toContain('pg_try_advisory_lock');expect(s.client.query.mock.calls.at(-1)![0]).toContain('pg_advisory_unlock');
 });
 it('refuses busy writer, two existing objects or truncated listings before export',async()=>{
  const busy=setup();busy.client.query.mockResolvedValueOnce({rows:[{locked:false}]});const factory=vi.fn(async()=>envelope());await expect(storeLedgerSnapshot(busy.client,busy.s3,'private-test',{factory})).rejects.toThrow('LEDGER_BACKUP_BUSY');expect(busy.s3.send).not.toHaveBeenCalled();
  for(const s of [setup([{Key:objectKey()},{Key:objectKey()}]),setup([],true)]){await expect(storeLedgerSnapshot(s.client,s.s3,'private-test',{factory})).rejects.toThrow('LEDGER_STORAGE_CAP_REACHED');expect(s.client.query.mock.calls.at(-1)![0]).toContain('unlock');}expect(factory).not.toHaveBeenCalled();
 });
 it('releases writer lock after upload failure and never overwrites existing content',async()=>{
  const s=setup();s.s3.send.mockImplementationOnce(async()=>({Contents:[],IsTruncated:false})).mockRejectedValueOnce(Error('synthetic storage error'));
  await expect(storeLedgerSnapshot(s.client,s.s3,'private-test',{now,factory:async()=>envelope()})).rejects.toThrow('synthetic storage error');expect(s.client.query.mock.calls.at(-1)![0]).toContain('unlock');
 });
 it('deletes only valid due namespace objects early, reports overdue, and never accesses DB/payload',async()=>{
  const early=objectKey(now.getTime()+59999),expired=objectKey(now.getTime()-1),future=objectKey();const s=setup([early,expired,future].map(Key=>({Key,LastModified:now,Size:500})));
  const report=await sweepLedgerBackups(s.s3,'private-test',{now,audit:s.audit});expect(report).toMatchObject({removed:2,overdue:1,invalid:0});expect(s.commands.filter(c=>c.constructor.name==='DeleteObjectCommand').map(c=>c.input.Key)).toEqual([early,expired]);expect(s.client.query).not.toHaveBeenCalled();expect(s.commands.every(c=>['ListObjectsV2Command','DeleteObjectCommand'].includes(c.constructor.name))).toBe(true);expect(s.events).toContainEqual({event:'backup.retention_violation',code:'LEDGER_TTL_EXCEEDED',count:1});
 });
 it('does not delete foreign, malformed, too-far future or oversized objects',async()=>{
  const s=setup([{Key:'other/normalized.webp'},{Key:LEDGER_PREFIX+'1/not-uuid.json'},{Key:objectKey(now.getTime()+7200000)},{Key:objectKey(now.getTime()-1),Size:32769}].map(o=>({LastModified:now,Size:500,...o})));
  expect((await sweepLedgerBackups(s.s3,'private-test',{now,audit:s.audit})).invalid).toBe(4);expect(s.commands).toHaveLength(1);expect(s.events.some(e=>e.code==='LEDGER_OBJECT_INVALID')).toBe(true);
 });
 it('caps a malformed oversized listing at four deletes and emits pagination/cap warning',async()=>{
  const s=setup(Array.from({length:10},()=>({Key:objectKey(now.getTime()-1),LastModified:now,Size:500})),true);
  expect(await sweepLedgerBackups(s.s3,'private-test',{now,audit:s.audit})).toMatchObject({scanned:4,removed:4,truncated:true});expect(s.commands[0].input).toMatchObject({Prefix:LEDGER_PREFIX,MaxKeys:4});expect(s.events.some(e=>e.code==='LEDGER_STORAGE_CAP_EXCEEDED')).toBe(true);
 });
 it('reports storage failure without throwing or revealing provider text',async()=>{
  const s=setup();s.s3.send.mockRejectedValueOnce(Error('synthetic sensitive provider detail'));expect((await sweepLedgerBackups(s.s3,'private-test',{now,audit:s.audit})).failed).toBe(1);expect(JSON.stringify(s.events)).not.toContain('sensitive');
 });
 it('shares a six-second deadline across listing/deletes and defers remaining work',async()=>{
  const controller=new AbortController(),timeout=vi.spyOn(AbortSignal,'timeout').mockImplementation(ms=>ms===6000?controller.signal:new AbortController().signal);
  const items=Array.from({length:4},()=>({Key:objectKey(now.getTime()-1),LastModified:now,Size:500}));let calls=0;
  const s3={send:vi.fn(async(_command:any,options:any)=>{calls++;if(calls===1)return{Contents:items};queueMicrotask(()=>controller.abort());return new Promise((_resolve,reject)=>options.abortSignal.addEventListener('abort',()=>reject(Error('deadline')),{once:true}));})};
  try{expect(await sweepLedgerBackups(s3,'private-test',{now})).toMatchObject({failed:1,deferred:3,removed:0});expect(calls).toBe(2);expect(timeout).toHaveBeenCalledWith(6000);}finally{timeout.mockRestore();}
 });
});

describe('manual backup binds PostgreSQL and private S3 to the same reviewed production branch',()=>{
 const origin=`https://${PRODUCTION_TARGET.branch}-api.compute.c-3.ap-southeast-1.aws.neon.tech`,host='ep-synthetic.c-3.ap-southeast-1.aws.neon.tech';
 const settings={PUBLIC_API_URL:origin,CORS_ORIGINS:'https://ssandevisthan.pages.dev',AUTH_JWT_SECRET_BASE64:Buffer.alloc(32,2).toString('base64'),INTERNAL_WORKER_SECRET:'w'.repeat(43),SCHEDULE_PATH_TOKEN:'s'.repeat(43),OPENAI_MODEL:'gpt-6.1-sol',PAID_EXECUTION_ENABLED:'false',NORMALIZER_VERIFIED:'true',EGRESS_VERIFIED:'true',NORMALIZER_VERSION:'sharp-webp-v3-1',INPUT_BUCKET:'search-images',VERIFIED_CLIENT_IP_HEADER:''};
 const url=new URL(`postgresql://${host}/neondb?sslmode=require`);url.username='neondb_owner';url.password=['synthetic','unused'].join('-');
 const input={connectionString:url.href,settings,apiKey:'synthetic-unused',bucket:'search-images',s3Endpoint:`https://${PRODUCTION_TARGET.branch}.storage.c-3.ap-southeast-1.aws.neon.tech`};
 function fetcher(access='private'){return vi.fn(async(path:RequestInfo|URL,init?:RequestInit)=>{expect(init?.method).toBe('GET');const p=String(path);return Response.json(p.endsWith('/endpoints')?{endpoints:[{id:'ep-synthetic',project_id:PRODUCTION_TARGET.project,branch_id:PRODUCTION_TARGET.branch,type:'read_write',host}]}:p.endsWith('/databases')?{databases:[{branch_id:PRODUCTION_TARGET.branch,name:'neondb'}]}:p.endsWith('/buckets')?{buckets:[{name:'search-images',access_level:access}]}:{function:{slug:'api',invocation_url:origin}});});}
 it('accepts the actual bound private destination using metadata reads only',async()=>{const get=fetcher();expect(await validateLedgerDestination(input,get)).toMatchObject({project:PRODUCTION_TARGET.project,branch:PRODUCTION_TARGET.branch});expect(get).toHaveBeenCalledTimes(4);});
 it.each([{bucket:'another-bucket'},{s3Endpoint:'https://evil.example'},{s3Endpoint:input.s3Endpoint+'/path'},{s3Endpoint:input.s3Endpoint.replace(PRODUCTION_TARGET.branch,'br-other')}])('rejects destination override %j',async change=>{await expect(validateLedgerDestination({...input,...change},fetcher())).rejects.toThrow('LEDGER_STORAGE_TARGET_MISMATCH');});
 it('rejects public or missing/unverified bucket access',async()=>{for(const access of ['public_read','unknown',''])await expect(validateLedgerDestination(input,fetcher(access))).rejects.toThrow('LEDGER_PRIVATE_BUCKET_REQUIRED');});
});
