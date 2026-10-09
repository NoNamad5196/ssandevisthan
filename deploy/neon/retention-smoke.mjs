import {readFile,writeFile} from 'node:fs/promises';
import sharp from 'sharp';
import pg from 'pg';
import {S3Client,PutObjectCommand,HeadObjectCommand} from '@aws-sdk/client-s3';
const settings=JSON.parse(await readFile('.secrets/backend.env.json','utf8')),credentials=JSON.parse(await readFile('.secrets/neon.json','utf8')),session=JSON.parse(await readFile('.secrets/live-session.json','utf8'));
const origin=settings.PUBLIC_API_URL,base=origin+'/functions/v1/api/v3';
const connection=new URL(credentials.DATABASE_URL);connection.searchParams.set('sslmode','verify-full');const db=new pg.Client({connectionString:connection.href});await db.connect();
const s3=new S3Client({region:credentials.AWS_REGION,endpoint:credentials.AWS_ENDPOINT_URL_S3,forcePathStyle:true,credentials:{accessKeyId:credentials.AWS_ACCESS_KEY_ID,secretAccessKey:credentials.AWS_SECRET_ACCESS_KEY}});
async function api(path,method='GET',body,type='application/json'){const r=await fetch(base+path,{method,headers:{Authorization:`Bearer ${session.accessToken}`,Origin:settings.CORS_ORIGINS,...(body===undefined?{}:{'Content-Type':type})},body:body===undefined?undefined:type==='application/json'?JSON.stringify(body):body});const j=r.status===204?null:await r.json();return{status:r.status,data:j};}
async function present(key){try{await s3.send(new HeadObjectCommand({Bucket:credentials.INPUT_BUCKET,Key:key}));return true;}catch(e){if(e.$metadata?.httpStatusCode===404)return false;throw e;}}
try{
 if(process.argv[2]==='setup'){
  const bytes=await sharp({create:{width:48,height:64,channels:4,background:{r:30,g:60,b:90,alpha:.5}}}).png().toBuffer();
  async function upload(){const created=await api('/uploads','POST',{schemaVersion:3,declaredMimeType:'image/png',declaredBytes:bytes.length});if(created.status!==201)throw new Error('UPLOAD_ADMISSION_FAILED');const id=created.data.data.uploadId;
   if((await api(`/uploads/${id}/content`,'PUT',bytes,'image/png')).status!==200||(await api(`/uploads/${id}/finalize`,'POST',{schemaVersion:3})).status!==200)throw new Error('UPLOAD_FAILED');return{id,key:`${session.userId}/${id}/normalized.webp`};}
  const terminal=await upload(),expired=await upload(),run=crypto.randomUUID(),oldRun=crypto.randomUUID();
  await db.query(`INSERT INTO public.search_runs(id,owner_id,mode,input_digest,input_descriptor,upload_id,status,stage,versions,failure,completed_at)
    VALUES($1,$2,'IMAGE_SIMILAR',repeat('0',64),' {"testFixture":"terminal retention only; no provider"}'::jsonb,$3,'FAILED','RANKING','{}','{"code":"OPERATOR_STOP","message":"Retention test fixture","retryable":false}',now())`,[run,session.userId,terminal.id]);
  await db.query(`UPDATE public.upload_sessions SET status='CONSUMED',consumed_by=$1 WHERE id=$2`,[run,terminal.id]);
  await db.query('SELECT public.queue_input_cleanup($1,false)',[run]);
  await db.query("UPDATE public.upload_sessions SET expires_at=now()-interval '1 second' WHERE id=$1",[expired.id]);
  await db.query(`INSERT INTO public.search_runs(id,owner_id,mode,input_digest,input_descriptor,query_text,status,stage,versions,failure,created_at,deadline_at,expires_at,completed_at)
    VALUES($1,$2,'DEAL_TEXT',repeat('0',64),'{"testFixture":"7-day expiry; no provider"}','retention fixture','FAILED','RANKING','{}','{"code":"OPERATOR_STOP","message":"Retention test fixture","retryable":false}',now()-interval '7 days 1 minute',now()-interval '7 days'+interval '30 seconds',now()-interval '1 minute',now()-interval '7 days 40 seconds')`,[oldRun,session.userId]);
  const hiddenUpload=await api(`/uploads/${expired.id}/finalize`,'POST',{schemaVersion:3}),hiddenRun=await api(`/searches/${oldRun}`);
  const cleanup=await fetch(origin+'/internal/sweep',{method:'POST',headers:{'x-internal-secret':settings.INTERNAL_WORKER_SECRET}});if(!cleanup.ok)throw new Error('CLEANUP_FAILED');
  const orphan=`${session.userId}/${crypto.randomUUID()}/normalized.webp`,orphanBytes=await sharp(bytes).webp().toBuffer();await s3.send(new PutObjectCommand({Bucket:credentials.INPUT_BUCKET,Key:orphan,Body:orphanBytes,ContentType:'image/webp'}));
  const available=(await db.query('SELECT available_at FROM public.cleanup_tasks WHERE upload_id=$1',[terminal.id])).rows[0].available_at;
  const state={startedAt:new Date().toISOString(),terminal,expired,run,oldRun,orphan,cleanupDueAt:available,immediateChecks:{expiredUploadHidden:hiddenUpload.status===410,expiredRunHidden:hiddenRun.status===410,expiredUploadRemoved:!(await present(expired.key)),expiredRunDeleted:(await db.query('SELECT id FROM public.search_runs WHERE id=$1',[oldRun])).rows.length===0}};
  await writeFile('.secrets/retention-fixture.json',JSON.stringify(state));console.info(JSON.stringify({startedAt:state.startedAt,cleanupDueAt:state.cleanupDueAt,immediateChecks:state.immediateChecks}));
 }else{
  const state=JSON.parse(await readFile('.secrets/retention-fixture.json','utf8'));const terminalRemoved=!(await present(state.terminal.key)),orphanRemoved=!(await present(state.orphan));
  const row=(await db.query('SELECT completed_at FROM public.cleanup_tasks WHERE object_key IS NULL AND completed_at>=$1 ORDER BY completed_at DESC LIMIT 1',[state.startedAt])).rows[0];
  const report={at:new Date().toISOString(),environment:'LIVE_NEON_CONTROLLED_RETENTION_FIXTURES',providerCalls:0,productSearchSuccess:false,...state.immediateChecks,terminalRemoved,orphanRemoved,cleanupDueAt:state.cleanupDueAt,latestCleanupAt:row?.completed_at??null};
  if(terminalRemoved&&orphanRemoved){await api(`/searches/${state.run}`,'DELETE');await fetch(origin+'/internal/sweep',{method:'POST',headers:{'x-internal-secret':settings.INTERNAL_WORKER_SECRET}});await writeFile('docs/deployment/retention-smoke.json',JSON.stringify(report,null,2)+'\n');}
  console.info(JSON.stringify(report));
 }
}finally{await db.end();}
