import {configureRuntime,AppError,audit} from '../../../supabase/shared/runtime.ts';
import {configureImages} from '../../../supabase/shared/images.ts';
import {configureSafeFetcher} from '../../../supabase/shared/safe-fetch.ts';
import {handleApi} from '../../../supabase/functions/api/index.ts';
import {handleWorker} from '../../../supabase/functions/worker/index.ts';
import {handleSweep} from '../../../supabase/functions/sweep/index.ts';
import {NeonDatabase,pool} from './database.ts';
import {authRoute,verifyOwner} from './auth.ts';
import {normalizeImage,validateImage} from './images.ts';
import {NodePinnedTransport,resolver} from './transport.ts';
import {waitUntil} from '@neon/functions';
import {diagnostics} from './diagnostics.ts';
import {maintenancePrelude,maintenanceCompleted,sweepOrphans} from './maintenance.ts';

const database=new NeonDatabase();
configureRuntime({database,owner:verifyOwner,env:name=>process.env[name],waitUntil,async wakeWorker(){
  const origin=process.env.PUBLIC_API_URL,secret=process.env.INTERNAL_WORKER_SECRET;if(!origin||!secret)return;
  await fetch(`${origin.replace(/\/$/,'')}/internal/worker`,{method:'POST',headers:{'x-internal-secret':secret},signal:AbortSignal.timeout(1000)}).then(()=>{}).catch(()=>{});
}});
configureImages({normalize:normalizeImage,validate:validateImage});
configureSafeFetcher({resolver,transport:new NodePinnedTransport()});

async function schedule(req:Request):Promise<Response>{
  const marker=process.env.SCHEDULE_PATH_TOKEN??'';
  // Neon strips client X-Neon-* headers (official scheduled-trigger contract).
  // Also require an independent secret path and a transactional minute dedupe.
  if(!req.headers.get('x-neon-trigger-invocation-id')||marker.length<32||new URL(req.url).pathname!==`/internal/schedule/${marker}`||req.method!=='POST')return new Response(null,{status:404});
  const activity=await maintenancePrelude();const orphansRemoved=await sweepOrphans(activity.active);
  if(!activity.active)return Response.json({ok:true,idle:true,orphansRemoved});
  const admitted=await pool.query(`INSERT INTO public.schedule_ticks(minute) VALUES(date_trunc('minute',now())) ON CONFLICT DO NOTHING RETURNING minute`);
  if(!admitted.rowCount)return Response.json({ok:true,reused:true});
  const internal=new Request(new URL('/internal/sweep',req.url),{method:'POST',headers:{'x-internal-secret':process.env.INTERNAL_WORKER_SECRET??''}});
  const response=await handleSweep(internal);
  await pool.query(`DELETE FROM public.schedule_ticks WHERE minute<now()-interval '1 day'; DELETE FROM auth.creation_events WHERE created_at<now()-interval '10 minutes'; DELETE FROM auth.anonymous_sessions WHERE expires_at<now();`);
  if(response.ok)await maintenanceCompleted(activity.due);
  return response;
}
export default {async fetch(req:Request):Promise<Response>{
  const path=new URL(req.url).pathname;
  try{
    if(path==='/health')return Response.json({service:'SSANDEVISTHAN',schemaVersion:3,backend:'neon',searchEnabled:process.env.PAID_EXECUTION_ENABLED==='true'},{headers:{'Cache-Control':'no-store'}});
    if(path==='/internal/worker')return handleWorker(req);
    if(path==='/internal/sweep')return handleSweep(req);
    if(path.startsWith('/internal/schedule/'))return schedule(req);
    if(path.startsWith('/internal/diagnostics/'))return diagnostics(req);
    if(req.method!=='OPTIONS'&&path==='/functions/v1/api/v3/auth/anonymous')return authRoute(req,false);
    if(req.method!=='OPTIONS'&&path==='/functions/v1/api/v3/auth/refresh')return authRoute(req,true);
    return handleApi(req);
  }catch(e){const code=e instanceof AppError?e.code:'TEMPORARILY_UNAVAILABLE';audit('neon.request_error',{code});return Response.json({ok:false,error:{code,message:'서비스 연결을 확인해 주세요.',retryable:true},meta:{requestId:crypto.randomUUID(),schemaVersion:3,createdAt:new Date().toISOString()}},{status:503,headers:{'Cache-Control':'no-store'}});}
}};
