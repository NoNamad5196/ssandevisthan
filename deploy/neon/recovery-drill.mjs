import assert from 'node:assert/strict';
import {mkdir,writeFile,readFile,cp} from 'node:fs/promises';
import {resolve} from 'node:path';
import {execFileSync} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {build} from 'esbuild';
import {PGlite} from '@electric-sql/pglite';
import {pgcrypto} from '@electric-sql/pglite/contrib/pgcrypto';
import {applyMigrations,migrationManifest} from './migrate.mjs';
import {exportRecoverySnapshot,restoreRecoverySnapshot} from './recovery.mjs';
import {verifyRelease,hash,assertDatabaseCompatibility} from './release.mjs';
import {checkRollback} from './rollback.mjs';
const started=new Date(),root=resolve(import.meta.dirname,'../..'),directory=resolve(root,'.cache/recovery-drill/'+Date.now()),checks=[];
await mkdir(directory,{recursive:true});
const check=(name,condition)=>{assert.ok(condition,name);checks.push({name,pass:true});};
const dbs=[];
async function database(){const db=new PGlite({extensions:{pgcrypto}});await db.waitReady;dbs.push(db);const client={async query(sql,params=[]){if(params.length)return db.query(sql,params);const rows=await db.exec(sql);return rows.at(-1)??{rows:[]};}};await applyMigrations(client);return client;}
const owner=randomUUID(),other=randomUUID(),done=randomUUID(),partial=randomUUID(),running=randomUUID(),expired=randomUUID(),unknown=randomUUID();
let exportedAt,restoredAt;
try{
 const source=await database(),target=await database();
 await source.query('INSERT INTO auth.users(id) VALUES($1),($2)',[owner,other]);
 await source.query(`UPDATE public.pilot_budget SET spent_microusd=123456,enabled=false,history_verified_at=now(),search_ceiling_microusd=15000000,minimum_search_reservation_microusd=10525000`);
 for(const [id,status] of [[done,'COMPLETED'],[partial,'PARTIAL'],[running,'RUNNING'],[expired,'NO_RELIABLE_MATCH']]){
  const created=id===expired?'now()-interval \'8 days\'':'now()';
  await source.query(`INSERT INTO public.search_runs(id,owner_id,mode,input_digest,input_descriptor,status,versions,created_at,deadline_at,expires_at) VALUES($1,$2,'DEAL_TEXT','fixture-only','{"schemaVersion":3,"query":"fixture","category":"ALL","resultLimit":10}',$3,'{"rankerVersion":"drill-historical-v1"}',${created},${created}+interval '90 seconds',${created}+interval '7 days')`,[id,owner,status]);
 }
 const fixtureBundle=await build({stdin:{contents:"export {fixtureDeal,FIXTURE_TIME} from './packages/fixtures/src/index.ts';export {rankDealCandidates} from './packages/search-core/src/index.ts';",resolveDir:root},bundle:true,platform:'node',format:'esm',write:false,logLevel:'silent'});
 const fixtures=await import('data:text/javascript;base64,'+Buffer.from(fixtureBundle.outputFiles[0].contents).toString('base64'));
 for(const [id,index] of [[done,1],[partial,2]]){
  const candidate=fixtures.fixtureDeal(index),ranked=fixtures.rankDealCandidates([candidate],fixtures.FIXTURE_TIME),result=ranked.eligible[0];assert.ok(result,'synthetic recommendation exists');
  await source.query(`INSERT INTO public.products(id,search_id,canonical_url,canonical_url_hash,source,title) VALUES($1,$2,$3,$4,'synthetic_fixture',$5)`,[candidate.productId,id,candidate.productUrl,hash(candidate.productUrl),candidate.title]);
  await source.query(`INSERT INTO public.product_variants(id,search_id,product_id,variant_key_hash,observed_at) VALUES($1,$2,$3,'fixture',now())`,[candidate.variantId,id,candidate.productId]);
  await source.query(`INSERT INTO public.offers(id,search_id,product_id,variant_id,merchant,product_url,condition,domestic_shipping,item_price,shipping_fee,effective_price,price_basis,stock_status) VALUES($1,$2,$3,$4,'SYNTHETIC_FIXTURE',$5,'NEW','CONFIRMED',20000,0,20000,'TOTAL_PRICE','IN_STOCK')`,[candidate.offerId,id,candidate.productId,candidate.variantId,candidate.productUrl]);
  await source.query(`INSERT INTO public.search_results(search_id,product_id,offer_id,mode,kind,price_basis,cohort_rank,deal_relevance,snapshot) VALUES($1,$2,$3,'DEAL_TEXT','RECOMMENDATION','TOTAL_PRICE',1,$4,$5)`,[id,candidate.productId,candidate.offerId,result.dealRelevance,JSON.stringify(result)]);
  await source.query(`INSERT INTO public.search_rank_snapshots(search_id,eligible,references_json,sort_orders,versions) VALUES($1,$2,'[]',$3,'{"rankerVersion":"drill-historical-v1"}')`,[id,JSON.stringify(ranked.eligible),JSON.stringify(ranked.sortOrders)]);
 }
 await source.query(`INSERT INTO public.search_rank_snapshots(search_id,eligible,references_json,sort_orders,versions) VALUES($1,'[]','[]','{"RECOMMENDED":[]}','{"rankerVersion":"expired-fixture"}')`,[expired]);
 await source.query(`INSERT INTO public.search_jobs(search_id,operation_key,stage,state,attempt,lease_token,lease_expires_at) VALUES($1,'old-terminal','RANKING','DONE',1,$3,now()),($2,'interrupted','DISCOVERING','LEASED',1,$3,now()+interval '20 seconds')`,[done,running,randomUUID()]);
 await source.query(`INSERT INTO public.budget_reservations(id,search_id,operation_key,reserved_microusd,state) VALUES($1,$2,'SEARCH',12000000,'RESERVED'),($3,$2,'discovery:1',10525000,'RESERVED')`,[unknown,running,randomUUID()]);
 await source.query(`INSERT INTO public.budget_reservations(search_id,operation_key,reserved_microusd,state,actual_microusd) VALUES($1,'SEARCH',1000000,'SETTLED',1000),($1,'analysis:1',1000000,'SETTLED',1000),($2,'SEARCH',900000,'RESERVED',null)`,[done,expired]);
 await source.query(`INSERT INTO public.provider_runs(search_id,operation_key,provider,operation,status,attempt) VALUES($1,'discovery:1','openai','discovery','STARTED',1)`,[running]);
 await source.query(`INSERT INTO public.upload_sessions(owner_id,declared_mime,declared_bytes,object_key) VALUES($1,'image/png',100,'fixture-private-key-not-for-backup')`,[owner]);
 const manifest={migrations:await migrationManifest()};await assert.rejects(checkRollback(source,manifest),/ROLLBACK_REQUIRES_JOB_DRAIN/);checks.push({name:'rollback rejects undrained active search',pass:true});
 const backup=await exportRecoverySnapshot(source);exportedAt=backup.payload.createdAt;
 const serialized=JSON.stringify(backup);check('backup excludes upload keys, job leases and expired snapshots',!serialized.includes('fixture-private-key-not-for-backup')&&!serialized.includes('lease_token')&&!serialized.includes(expired));
 const backupPath=resolve(directory,'fixture-metadata.json');await writeFile(backupPath,serialized,{mode:0o600});
 const fromDisk=JSON.parse(await readFile(backupPath,'utf8'));const recovered=await restoreRecoverySnapshot(target,fromDisk);restoredAt=new Date().toISOString();check('fresh independent PostgreSQL restores three unexpired searches',recovered.restoredSearches===3);
 check('restored active search explicitly fails and is never enqueued',recovered.interruptedSearches===1&&(await target.query("SELECT status,failure FROM public.search_runs WHERE id=$1",[running])).rows[0].failure.code==='OPERATOR_STOP');
 const b=(await target.query('SELECT * FROM public.pilot_budget')).rows[0];check('known spend remains and post-loss reconciliation is required',Number(b.spent_microusd)===123456&&!b.enabled&&b.history_verified_at===null&&b.free_quota_verified_at===null);
 check('uncertain reservations retain full amount and state',(await target.query("SELECT reserved_microusd,state FROM public.budget_reservations WHERE id=$1",[unknown])).rows[0].state==='RESERVED'&&Number((await target.query("SELECT reserved_microusd FROM public.budget_reservations WHERE id=$1",[unknown])).rows[0].reserved_microusd)===12000000);
 check('expired run does not erase its unresolved global reservation',Number((await target.query("SELECT sum(reserved_microusd) n FROM public.budget_reservations WHERE state='RESERVED' AND operation_key='SEARCH'")).rows[0].n)===12900000&&(await target.query("SELECT search_id FROM public.budget_reservations WHERE operation_key='SEARCH' AND reserved_microusd=900000")).rows[0].search_id===null);
 check('interrupted provider remains uncertain',(await target.query('SELECT status FROM public.provider_runs')).rows[0].status==='UNCERTAIN');
 const before=JSON.stringify((await source.query('SELECT eligible,sort_orders,versions FROM public.search_rank_snapshots WHERE search_id=$1',[done])).rows[0]);
 check('historical snapshot and ranking version preserved byte for byte',before===JSON.stringify((await target.query('SELECT eligible,sort_orders,versions FROM public.search_rank_snapshots WHERE search_id=$1',[done])).rows[0]));
 const ownershipSql='SELECT id,owner_id,status,created_at,expires_at,versions FROM public.search_runs WHERE id=ANY($1::uuid[]) ORDER BY id';
 check('COMPLETED and PARTIAL preserve original owners, state, expiry and version',JSON.stringify((await source.query(ownershipSql,[[done,partial]])).rows)===JSON.stringify((await target.query(ownershipSql,[[done,partial]])).rows));
 check('restored recommendations retain product and offer relational ownership',Number((await target.query('SELECT count(*) n FROM public.search_results r JOIN public.products p ON p.id=r.product_id AND p.search_id=r.search_id JOIN public.offers o ON o.id=r.offer_id AND o.search_id=r.search_id JOIN public.search_runs s ON s.id=r.search_id WHERE s.owner_id=$1',[owner])).rows[0].n)===2);
 check('neither expired search nor expired snapshot revived',(await target.query('SELECT id FROM public.search_runs WHERE id=$1',[expired])).rows.length===0&&(await target.query('SELECT search_id FROM public.search_rank_snapshots WHERE search_id=$1',[expired])).rows.length===0);
 check('no image object or lease restored',Number((await target.query('SELECT count(*) n FROM public.upload_sessions')).rows[0].n)===0&&Number((await target.query('SELECT count(*) n FROM public.search_jobs')).rows[0].n)===0);
 check('restored terminal jobs cannot be claimed',(await target.query('SELECT * FROM public.claim_search_job()')).rows.length===0);
 await assert.rejects(target.query('SELECT assert_lease($1,$2,$3)',[1,randomUUID(),1]),/LEASE_LOST/);checks.push({name:'old worker lease is fenced after restore',pass:true});
 await assert.rejects(target.query('SELECT accept_search($1,$2,$3,$4,$5,$6)',[owner,'fixture-after-restore','DEAL_TEXT','{"schemaVersion":3,"query":"fixture","category":"ALL","resultLimit":10}','{}','fixture-ip']),/TEMPORARILY_UNAVAILABLE/);checks.push({name:'restored budget kill switch blocks new paid search admission',pass:true});
 await target.query('SELECT close_search_budget($1)',[running]);await target.query('SELECT close_search_budget($1)',[running]);
 await target.query('SELECT close_search_budget($1)',[done]);await target.query('SELECT close_search_budget($1)',[done]);
 check('repeated terminal settlement does not release or double-charge unknown usage',Number((await target.query('SELECT spent_microusd FROM public.pilot_budget')).rows[0].spent_microusd)===123456&&(await target.query('SELECT state FROM public.budget_reservations WHERE id=$1',[unknown])).rows[0].state==='RESERVED');
 await target.query('BEGIN');await target.query('SET LOCAL ROLE authenticated');await target.query("SELECT set_config('request.jwt.claim.sub',$1,true)",[other]);check('restored RLS hides another owner search',(await target.query('SELECT id FROM public.search_runs')).rows.length===0);await target.query("SELECT set_config('request.jwt.claim.sub',$1,true)",[owner]);check('restored RLS permits original owner metadata',(await target.query('SELECT id FROM public.search_runs')).rows.length===3);await target.query('ROLLBACK');
 await assert.rejects(restoreRecoverySnapshot(target,backup),/RESTORE_TARGET_NOT_EMPTY/);checks.push({name:'restore refuses overwrite of an existing database',pass:true});
 const empty=await database();await assert.rejects(restoreRecoverySnapshot(empty,backup,new Date(Date.parse(backup.payload.expiresAt)+1)),/RECOVERY_EXPORT_EXPIRED/);checks.push({name:'expired backup rejected rather than resurrecting TTL data',pass:true});
 const changed=structuredClone(backup);changed.payload.budget.spent_microusd=0;await assert.rejects(restoreRecoverySnapshot(empty,changed),/RECOVERY_CHECKSUM_MISMATCH/);checks.push({name:'tampered metadata checksum rejected',pass:true});
 check('drained recovered database satisfies code-only rollback preflight',(await checkRollback(target,manifest)).schemaCompatible);
 assert.throws(()=>assertDatabaseCompatibility(manifest.migrations,[...manifest.migrations,{name:'unknown.sql',sha256:'bad'}]),/ROLLBACK_SCHEMA_COMPATIBILITY_UNVERIFIED/);checks.push({name:'unknown schema changes block old code rollback',pass:true});
 // Execute the actual worker handler against restored PostgreSQL, with all
 // outbound fetches denied. The fixture secret exists only in this process.
 const module=await build({stdin:{contents:"export {configureRuntime} from './supabase/shared/runtime.ts';export {handleWorker} from './supabase/functions/worker/index.ts';",resolveDir:root},bundle:true,platform:'node',format:'esm',write:false,external:['@imagemagick/magick-wasm'],logLevel:'silent'});
 const runtime=await import('data:text/javascript;base64,'+Buffer.from(module.outputFiles[0].contents).toString('base64'));let outbound=0;const oldFetch=globalThis.fetch;globalThis.fetch=async()=>{outbound++;throw Error('DRILL_NETWORK_DISABLED');};
 try{runtime.configureRuntime({database:{rpc:async()=> (await target.query('SELECT * FROM public.claim_search_job()')).rows},env:name=>name==='INTERNAL_WORKER_SECRET'?'fixture-worker-secret':undefined,owner:async()=>owner,wakeWorker:async()=>{}});
  const reply=await runtime.handleWorker(new Request('https://fixture.invalid/internal/worker',{method:'POST',headers:{'x-internal-secret':'fixture-worker-secret'}}));check('actual worker HTTP handler finds no restored work or paid call',reply.status===200&&(await reply.json()).claimed===false&&outbound===0);
 }finally{globalThis.fetch=oldFetch;}
 // A copied release is validated before and after a deliberate damaged file.
 // ARM64 binaries are verified bytewise; they are not executed on this host.
 const release=resolve(root,'.cache/neon-bundle');let artifactDirty;try{const options={allowDirtyForDrill:true},sealed=await verifyRelease(release,undefined,options);artifactDirty=sealed.sourceDirty;const restoredRelease=resolve(directory,'restored-release');await cp(release,restoredRelease,{recursive:true});await verifyRelease(restoredRelease,sealed.gitSha,options);checks.push({name:'retained API/worker artifact copy restores all exact checksums',pass:true});
  const entry=resolve(restoredRelease,'index.mjs'),original=await readFile(entry);await writeFile(entry,Buffer.concat([original,Buffer.from('\n// fault injection\n')]));await assert.rejects(verifyRelease(restoredRelease,undefined,options),/RELEASE_CONTENT_MISMATCH/);await writeFile(entry,original);await verifyRelease(restoredRelease,undefined,options);checks.push({name:'corrupted artifact rejected then prior exact artifact restored',pass:true});
  const provenancePath=resolve(restoredRelease,'build-provenance.json'),manifestPath=resolve(restoredRelease,'release-manifest.json'),originalProvenance=await readFile(provenancePath),originalManifest=await readFile(manifestPath);
  const wrongProvenance=Buffer.from(JSON.stringify({...JSON.parse(originalProvenance),gitSha:'0'.repeat(40)})),wrongManifest=JSON.parse(originalManifest),file=wrongManifest.files.find(f=>f.name==='build-provenance.json');file.sha256=hash(wrongProvenance);file.bytes=wrongProvenance.length;
  await writeFile(provenancePath,wrongProvenance);await writeFile(manifestPath,JSON.stringify(wrongManifest));await assert.rejects(verifyRelease(restoredRelease,undefined,options),/RELEASE_BUILD_PROVENANCE_INVALID/);await writeFile(provenancePath,originalProvenance);await writeFile(manifestPath,originalManifest);await verifyRelease(restoredRelease,undefined,options);checks.push({name:'mismatched build commit rejected even with a recomputed file checksum',pass:true});
  if(artifactDirty){await assert.rejects(verifyRelease(restoredRelease),/RELEASE_UNCOMMITTED_SOURCE_REJECTED/);checks.push({name:'production validator refuses dirty drill artifact',pass:true});}
 }catch(e){throw Error('BUILD_AND_SEAL_RELEASE_BEFORE_DRILL: '+e.message);}
 const report={evaluationId:'recovery-'+started.getTime(),startedAt:started.toISOString(),exportedAt,restoredAt,completedAt:new Date().toISOString(),gitSha:execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim(),artifactSourceDirty:artifactDirty,environment:'ISOLATED_LOCAL_PGLITE',mode:'SYNTHETIC_FIXTURE',liveProductSearchSuccess:false,paidProviderCalls:0,productionWrites:0,resourceCostUsd:0,checks,limitations:['No production user data was exported or restored.','No cloud service or production database was rolled back.','ARM64 release bytes were restored and checked; cloud runtime rollback remains untested.','Anonymous refresh-session secrets and images are not backed up; re-upload may be necessary.','No RPO/RTO or zero-loss guarantee; reconciliation covers the possible loss interval after backup.']};
 await writeFile(resolve(directory,'report.json'),JSON.stringify(report,null,2)+'\n');await writeFile(resolve(root,'.cache/recovery-drill-latest.json'),JSON.stringify(report,null,2)+'\n');console.info(JSON.stringify({report:resolve(directory,'report.json'),checks:checks.length,pass:true,environment:report.environment,paidProviderCalls:0,productionWrites:0}));
}finally{for(const db of dbs)await db.close();}
