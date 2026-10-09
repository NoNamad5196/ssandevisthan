import {lookup} from 'node:dns/promises';
import {request} from 'node:https';
import {isIP} from 'node:net';
import {AppError} from '../../../supabase/shared/runtime.ts';
import type {PinnedTransport,Resolver,SafeResponse} from '../../../supabase/shared/safe-fetch.ts';
export const resolver:Resolver={async resolve(host){return(await lookup(host,{all:true,verbatim:true})).map(r=>r.address);}};
export class NodePinnedTransport implements PinnedTransport{
  constructor(private readonly validationProbe=false){}
  get(url:URL,ip:string,signal:AbortSignal,cap:number):Promise<SafeResponse>{
    if(!this.validationProbe&&process.env.EGRESS_VERIFIED!=='true')throw new AppError('EGRESS_UNVERIFIED',503);
    return new Promise((resolve,reject)=>{
      const req=request(url,{method:'GET',agent:false,servername:url.hostname,rejectUnauthorized:true,maxHeaderSize:32768,signal,family:isIP(ip),
        lookup:((_host:any,_options:any,callback:any)=>callback(null,ip,isIP(ip))) as any,
        headers:{Accept:'text/html,image/jpeg,image/png,image/webp','Accept-Encoding':'identity','User-Agent':'SSANDEVISTHAN/3 (+public-product-verification)'}},res=>{
          const headers=new Headers();for(const [key,value] of Object.entries(res.headers))if(value!==undefined)headers.set(key,Array.isArray(value)?value.join(','):value);
          if(headers.has('content-encoding')&&headers.get('content-encoding')!=='identity'){res.destroy();reject(new AppError('UNSUPPORTED_CONTENT_ENCODING',502));return;}
          let size=0;const chunks:Buffer[]=[];res.on('data',(chunk:Buffer)=>{size+=chunk.length;if(size>cap){res.destroy(new AppError('RESPONSE_TOO_LARGE',413));return;}chunks.push(chunk);});
          res.on('error',reject);res.on('end',()=>resolve({url:url.href,status:res.statusCode??0,headers,bytes:new Uint8Array(Buffer.concat(chunks,size))}));
        });
      req.on('error',reject);req.end();
    });
  }
}
