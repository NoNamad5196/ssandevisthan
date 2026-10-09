import { isPublicIpAddress, validatePublicHttpsUrl } from '@ssandevisthan/search-core';
import { AppError, boundedBody, env } from './runtime.ts';

export interface SafeResponse {url:string;status:number;headers:Headers;bytes:Uint8Array}
export interface PinnedTransport {get(url:URL,ip:string,signal:AbortSignal,cap:number):Promise<SafeResponse>}
export interface Resolver {resolve(host:string):Promise<string[]>}
export interface SourceGuard {enter(host:string):Promise<(()=>Promise<void>)|null>}
let fetchAdapter:{resolver:Resolver;transport:PinnedTransport}|null=null;
export function configureSafeFetcher(adapter:NonNullable<typeof fetchAdapter>){fetchAdapter=adapter;}
function abortBound<T>(promise:Promise<T>,signal:AbortSignal,late?:(value:T)=>void):Promise<T>{
  return new Promise((resolve,reject)=>{
    let finished=false;const abort=()=>{if(!finished){finished=true;reject(new AppError('TIMEOUT',504));}};
    signal.addEventListener('abort',abort,{once:true});if(signal.aborted)abort();
    promise.then(value=>{signal.removeEventListener('abort',abort);if(finished){late?.(value);return;}finished=true;resolve(value);},error=>{signal.removeEventListener('abort',abort);if(!finished){finished=true;reject(error);}});
  });
}
export function isChallengePage(html:string):boolean{
  // Product pages can contain ordinary report-abuse links mentioning captcha.
  // Stop on actual challenge documents/forms; never interact with them.
  const shortText=html.length<4096?html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,'').replace(/<[^>]*>/g,' ').trim():'';
  return /^(?:verify you are human|access denied|please (?:solve|complete) (?:the )?captcha)[.!\s]*$/i.test(shortText)
    || /<title\b[^>]*>[^<]*(?:captcha|access denied|just a moment|security check|verify (?:you|your))/i.test(html)
    || /(?:id|class)\s*=\s*["'][^"']*\bcf-chl-|\/cdn-cgi\/challenge-platform\//i.test(html)
    || /<form\b[^>]*(?:id|action)\s*=\s*["'][^"']*(?:captcha|challenge)/i.test(html)
    || /<(?:h1|h2)\b[^>]*>[^<]*(?:access denied|verify you are human|complete (?:the )?captcha)/i.test(html);
}

/** Uses a resolved public address for the TCP connection, then the ORIGINAL hostname
 * for TLS SNI and certificate validation. There is no second hostname resolution.
 * This is ordinary direct HTTPS, never an alternate network path around a block. */
export class DenoPinnedTransport implements PinnedTransport {
  async get(url:URL,ip:string,signal:AbortSignal,cap:number):Promise<SafeResponse>{
    if(env('EGRESS_VERIFIED')!=='true')throw new AppError('EGRESS_UNVERIFIED',503);
    let socket:Deno.Conn|Deno.TlsConn|undefined;
    const close=()=>{try{socket?.close();}catch{/* already closed */}};
    signal.addEventListener('abort',close,{once:true});
    try{
      signal.throwIfAborted();socket=await abortBound(Deno.connect({hostname:ip,port:443,transport:'tcp'}),signal,s=>s.close());
      if(socket.remoteAddr.transport!=='tcp'||!isPublicIpAddress(socket.remoteAddr.hostname))throw new AppError('SSRF_BLOCKED',400);
      signal.throwIfAborted();socket=await abortBound(Deno.startTls(socket as Deno.TcpConn,{hostname:url.hostname,alpnProtocols:['http/1.1']}),signal,s=>s.close());
      const request=new TextEncoder().encode(`GET ${url.pathname}${url.search} HTTP/1.1\r\nHost: ${url.host}\r\nAccept: text/html,image/jpeg,image/png,image/webp\r\nAccept-Encoding: identity\r\nConnection: close\r\nUser-Agent: SSANDEVISTHAN/3 (+public-product-verification)\r\n\r\n`);
      let sent=0;while(sent<request.length)sent+=await socket.write(request.subarray(sent));
      const chunks:Uint8Array[]=[];let total=0;const buffer=new Uint8Array(16384);
      while(true){signal.throwIfAborted();const n=await socket.read(buffer);if(n===null)break;total+=n;
        // Wire and decoded bodies are separately bounded. No zip-bomb allocation.
        if(total>cap+65536)throw new AppError('RESPONSE_TOO_LARGE',413);chunks.push(buffer.slice(0,n));}
      const all=new Uint8Array(total);let offset=0;for(const c of chunks){all.set(c,offset);offset+=c.length;}
      let boundary=-1;for(let i=0;i<Math.min(all.length-3,32768);i++)if(all[i]===13&&all[i+1]===10&&all[i+2]===13&&all[i+3]===10){boundary=i;break;}
      if(boundary<0)throw new AppError('INVALID_HTTP_RESPONSE',502);
      const lines=new TextDecoder('utf-8',{fatal:true}).decode(all.slice(0,boundary)).split('\r\n');const status=Number(lines.shift()?.match(/^HTTP\/1\.[01] (\d{3}) /)?.[1]);
      if(!Number.isInteger(status)||status<200||status>599)throw new AppError('INVALID_HTTP_RESPONSE',502);
      const headers=new Headers();for(const line of lines){const p=line.indexOf(':');if(p<1||/^[ \t]/.test(line))throw new AppError('INVALID_HTTP_RESPONSE',502);headers.append(line.slice(0,p),line.slice(p+1).trim());}
      let bytes:Uint8Array=all.slice(boundary+4);const transfer=headers.get('transfer-encoding');
      if(transfer){if(transfer.toLowerCase()!=='chunked'||headers.has('content-length'))throw new AppError('INVALID_HTTP_RESPONSE',502);bytes=decodeChunks(bytes,cap);}
      else if(headers.has('content-length')&&Number(headers.get('content-length'))!==bytes.length)throw new AppError('INVALID_HTTP_RESPONSE',502);
      const encoding=headers.get('content-encoding');if(encoding&&encoding!=='identity')throw new AppError('UNSUPPORTED_CONTENT_ENCODING',502);
      if(bytes.length>cap)throw new AppError('RESPONSE_TOO_LARGE',413);
      return{url:url.href,status,headers,bytes};
    }finally{signal.removeEventListener('abort',close);close();}
  }
}
export function decodeChunks(wire:Uint8Array,cap:number):Uint8Array{
  let p=0,total=0;const chunks:Uint8Array[]=[];
  while(p<wire.length){let end=-1;for(let i=p;i<Math.min(wire.length-1,p+256);i++)if(wire[i]===13&&wire[i+1]===10){end=i;break;}
    if(end<0)throw new AppError('INVALID_HTTP_RESPONSE',502);
    const line=new TextDecoder().decode(wire.slice(p,end));if(!/^[\da-fA-F]+(?:;[^\r\n]*)?$/.test(line))throw new AppError('INVALID_HTTP_RESPONSE',502);
    const size=parseInt(line.split(';')[0],16);p=end+2;if(size===0){const out=new Uint8Array(total);let o=0;for(const c of chunks){out.set(c,o);o+=c.length;}return out;}
    total+=size;if(!Number.isSafeInteger(size)||total>cap)throw new AppError('RESPONSE_TOO_LARGE',413);
    if(p+size+2>wire.length||wire[p+size]!==13||wire[p+size+1]!==10)throw new AppError('INVALID_HTTP_RESPONSE',502);
    chunks.push(wire.slice(p,p+size));p+=size+2;
  }throw new AppError('INVALID_HTTP_RESPONSE',502);
}
const dnsResolver:Resolver={async resolve(host){
  const results=await Promise.allSettled([Deno.resolveDns(host,'A'),Deno.resolveDns(host,'AAAA')]);
  return results.flatMap(r=>r.status==='fulfilled'?r.value:[]);
}};
export class SafeFetcher{
  constructor(private resolver:Resolver=fetchAdapter?.resolver??dnsResolver,private transport:PinnedTransport=fetchAdapter?.transport??new DenoPinnedTransport(),private guard?:SourceGuard){}
  async get(input:string,kind:'html'|'image',deadline:number):Promise<SafeResponse>{
    let url=new URL(input);const cap=kind==='html'?2000000:10000000;
    const remaining=Math.min(8000,deadline-Date.now()-2000);if(remaining<=0)throw new AppError('TIMEOUT',504);
    const signal=AbortSignal.timeout(remaining);
    for(let redirects=0;redirects<=3;redirects++){
      try{url=validatePublicHttpsUrl(url.href);}catch{throw new AppError('SSRF_BLOCKED',400);}
      const addresses=await abortBound(this.resolver.resolve(url.hostname),signal);
      if(!addresses.length||addresses.some(ip=>!isPublicIpAddress(ip)))throw new AppError('SSRF_BLOCKED',400);
      const release=this.guard?await abortBound(this.guard.enter(url.hostname),signal,fn=>{void fn?.().catch(()=>{});}):undefined;
      if(release===null)throw new AppError('SOURCE_BUSY',503,true);
      let response:SafeResponse;
      try{response=await abortBound(this.transport.get(url,addresses[0],signal,cap),signal);}
      finally{if(release)await abortBound(release(),signal).catch(()=>{});}
      if(response.status===403)throw new AppError('BLOCKED',403);
      if(response.status===429)throw new AppError('RATE_LIMITED',429);
      if([301,302,303,307,308].includes(response.status)){
        if(redirects===3)throw new AppError('REDIRECT_LIMIT',502);const location=response.headers.get('location');if(!location)throw new AppError('INVALID_HTTP_RESPONSE',502);
        url=new URL(location,url);continue;
      }
      if(response.status!==200)throw new AppError(response.status>=500?'SOURCE_UNAVAILABLE':'PAGE_NOT_PRODUCT',502);
      const mime=response.headers.get('content-type')?.split(';')[0].trim().toLowerCase();
      if(kind==='html'&&mime!=='text/html')throw new AppError('INVALID_CONTENT_TYPE',415);
      if(kind==='image'&&!['image/jpeg','image/png','image/webp'].includes(mime??''))throw new AppError('INVALID_CONTENT_TYPE',415);
      if(kind==='html'&&isChallengePage(new TextDecoder().decode(response.bytes)))throw new AppError('BLOCKED',403);
      return response;
    }throw new AppError('REDIRECT_LIMIT',502);
  }
}
