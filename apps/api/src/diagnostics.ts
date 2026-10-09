import {internalAuth,AppError} from '../../../supabase/shared/runtime.ts';
import {SafeFetcher} from '../../../supabase/shared/safe-fetch.ts';
import {benchmarkNormalizer} from './images.ts';
import {NodePinnedTransport,resolver} from './transport.ts';
export async function diagnostics(req:Request){
  if(req.method!=='POST')return new Response(null,{status:405});internalAuth(req);
  const test=new URL(req.url).pathname.split('/').at(-1);
  if(test==='normalizer')return Response.json(await benchmarkNormalizer(),{headers:{'Cache-Control':'no-store'}});
  if(test==='egress'){
    const transport=new NodePinnedTransport(true),fetcher=new SafeFetcher(resolver,transport);let privateBlocked=false,rebindBlocked=false,mixedBlocked=false;
    const isBlocked=async(p:Promise<unknown>)=>{try{await p;return false;}catch(e){return e instanceof AppError&&e.code==='SSRF_BLOCKED';}};
    privateBlocked=await isBlocked(fetcher.get('https://127.0.0.1/','html',Date.now()+10000));
    rebindBlocked=await isBlocked(new SafeFetcher({resolve:async()=>['127.0.0.1']},transport).get('https://example.com/','html',Date.now()+10000));
    mixedBlocked=await isBlocked(new SafeFetcher({resolve:async()=>['93.184.215.14','10.0.0.1']},transport).get('https://example.com/','html',Date.now()+10000));
    const publicResponse=await fetcher.get('https://example.com/','html',Date.now()+10000);
    return Response.json({pass:privateBlocked&&rebindBlocked&&mixedBlocked&&publicResponse.status===200,privateBlocked,rebindBlocked,mixedBlocked,publicStatus:publicResponse.status,publicBytes:publicResponse.bytes.length,eucKrSupported:new TextDecoder('euc-kr').encoding==='euc-kr'},{headers:{'Cache-Control':'no-store'}});
  }
  return new Response(null,{status:404});
}
