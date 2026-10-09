import {DeleteObjectCommand,GetObjectCommand,ListObjectsV2Command,PutObjectCommand} from '@aws-sdk/client-s3';
import {bucket,s3,pool} from './database.ts';
import {audit} from '../../../supabase/shared/runtime.ts';
const call=<T>(command:any):Promise<T>=>s3.send(command,{abortSignal:AbortSignal.timeout(8000)}) as Promise<T>;
const remove=(Key:string)=>call(new DeleteObjectCommand({Bucket:bucket,Key}));
export async function maintenancePrelude(){
  const now=Date.now();let active=false;const due:string[]=[];
  const hot:any=await call(new ListObjectsV2Command({Bucket:bucket,Prefix:'_runtime/hot/',MaxKeys:100}));
  for(const object of hot.Contents??[]){const at=Number(object.Key.split('/').at(-1));if(Number.isFinite(at)&&at+70*60000>now)active=true;else await remove(object.Key);}
  if(hot.IsTruncated)active=true; // Conservative recovery while old markers drain.
  const future:any=await call(new ListObjectsV2Command({Bucket:bucket,Prefix:'_runtime/retention/',MaxKeys:100}));
  for(const object of future.Contents??[]){const at=Number(object.Key.split('/').at(-1));if(Number.isFinite(at)&&at<=now){active=true;due.push(object.Key);}}
  return{active,due};
}
export async function maintenanceCompleted(due:string[]){
  // Preserve the next real DB retention deadline while idle, without keeping the
  // 0.25CU compute awake every minute. RLS/API visibility still checks wall time.
  const result=await pool.query(`SELECT min(at) at FROM (SELECT min(expires_at) at FROM public.search_runs UNION ALL SELECT min(expires_at) FROM auth.anonymous_sessions) x`);
  const at=result.rows[0]?.at;if(at){const minute=Math.ceil(new Date(at).getTime()/60000)*60000;
    await call(new PutObjectCommand({Bucket:bucket,Key:`_runtime/retention/${minute}`,Body:'1',ContentType:'text/plain'}));}
  for(const key of due)await remove(key);
}
export async function sweepOrphans(databaseActive:boolean){
  const cursorKey='_runtime/orphan-cursor.json';let token:string|undefined;
  try{const cursor:any=await call(new GetObjectCommand({Bucket:bucket,Key:cursorKey}));token=JSON.parse(await cursor.Body.transformToString()).token??undefined;}catch(e:any){if(e?.$metadata?.httpStatusCode!==404)throw e;}
  let page:any;try{page=await call(new ListObjectsV2Command({Bucket:bucket,MaxKeys:100,ContinuationToken:token}));}catch(e:any){if(!token||e?.$metadata?.httpStatusCode!==400)throw e;page=await call(new ListObjectsV2Command({Bucket:bucket,MaxKeys:100}));}
  let removed=0;
  for(const object of page.Contents??[]){const match=object.Key?.match(/^([a-f0-9-]{36})\/([a-f0-9-]{36})\/normalized\.webp$/);if(!match)continue;
    const age=Date.now()-new Date(object.LastModified).getTime();if(age<30000)continue;let orphan=age>=3600000;
    if(!orphan&&databaseActive){const found=await pool.query('SELECT object_key,status,deleted_at,expires_at,lease_expires_at FROM public.upload_sessions WHERE id=$1 AND owner_id=$2',[match[2],match[1]]);const u=found.rows[0];
      orphan=!u||!!u.deleted_at||['DELETED','EXPIRED'].includes(u.status)||new Date(u.expires_at).getTime()<=Date.now();
      if(u?.status==='PROCESSING'&&new Date(u.lease_expires_at).getTime()>Date.now())orphan=false;}
    if(orphan){await remove(object.Key);removed++;if(age>=3600000)audit('cleanup.retention_violation',{code:'ORPHAN_IMAGE_TTL_EXCEEDED',count:1});}
  }
  if(page.NextContinuationToken)await call(new PutObjectCommand({Bucket:bucket,Key:cursorKey,Body:JSON.stringify({token:page.NextContinuationToken}),ContentType:'application/json'}));else if(token)await remove(cursorKey);
  return removed;
}
