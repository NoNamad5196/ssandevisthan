import {AppError,Database,audit,deferWork,internalAuth,wakeWorker} from '../../shared/runtime.ts';
import {processJob} from '../../shared/pipeline.ts';
export async function handleWorker(req:Request):Promise<Response>{
  try{
    if(req.method!=='POST')return new Response(null,{status:405});internalAuth(req);
    const db=new Database();const jobs=await db.rpc('claim_search_job');const job=jobs?.[0];
    if(!job)return Response.json({ok:true,claimed:false});
    await processJob(db,job);
    deferWork(wakeWorker());
    return Response.json({ok:true,claimed:true});
  }catch(e){const code=e instanceof AppError?e.code:'INTERNAL_ERROR';audit('worker.request_error',{code});return Response.json({ok:false,error:{code}},{status:code==='UNAUTHENTICATED'?401:503});}
}
if(import.meta.main)Deno.serve(handleWorker);
