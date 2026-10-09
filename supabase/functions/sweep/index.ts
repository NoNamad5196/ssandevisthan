import {AppError,Database,audit,internalAuth,wakeWorker} from '../../shared/runtime.ts';
import {rankPayload} from '../../shared/pipeline.ts';
export async function handleSweep(req:Request):Promise<Response>{
  try{
    if(req.method!=='POST')return new Response(null,{status:405});internalAuth(req);const db=new Database();
    const expired=await db.rows('search_runs',`status=in.(QUEUED,RUNNING)&deleted_at=is.null&deadline_at=lte.${encodeURIComponent(new Date().toISOString())}&limit=20`);
    for(const run of expired){const payload=await rankPayload(db,run,true);await db.rpc('recover_terminal',{p_search:run.id,p_payload:payload});}
    const result=await db.rpc('sweep_searches');const cleanup=await db.rpc('claim_cleanup');let removed=0;
    for(const task of cleanup??[]){try{
      if(task.object_key)await db.storageDelete(task.object_key);await db.rpc('complete_cleanup',{p_id:task.id});removed++;
    }catch{audit('cleanup.failed',{code:'STORAGE_DELETE_FAILED',count:task.attempt});}}
    // Stored object keys survive failed cleanup; DB cascade never loses deletion work.
    const overdue=await db.rows('upload_sessions',`object_key=not.is.null&expires_at=lt.${encodeURIComponent(new Date().toISOString())}&limit=100`);
    if(overdue.length)audit('cleanup.retention_violation',{code:'IMAGE_TTL_EXCEEDED',count:overdue.length});
    await wakeWorker();return Response.json({ok:true,...result,removed});
  }catch(e){const code=e instanceof AppError?e.code:'INTERNAL_ERROR';audit('sweep.error',{code});return Response.json({ok:false,error:{code}},{status:code==='UNAUTHENTICATED'?401:503});}
}
if(import.meta.main)Deno.serve(handleSweep);
