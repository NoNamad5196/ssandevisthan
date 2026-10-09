import {SEARCH_VERSIONS} from '@ssandevisthan/search-core';
export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
export type Row = Record<string, any>;
export interface DatabaseDriver {
  rows(table:string,query:string):Promise<Row[]>;one(table:string,query:string):Promise<Row|null>;
  insert(table:string,row:Row):Promise<Row>;patch(table:string,query:string,row:Row):Promise<Row[]>;rpc(name:string,args?:Row):Promise<any>;
  storageGet(key:string):Promise<Uint8Array>;storagePut(key:string,bytes:Uint8Array):Promise<void>;storageDelete(key:string):Promise<void>;signedInput(key:string,seconds:number):Promise<string>;
}
interface RuntimeAdapter {database:DatabaseDriver;owner(req:Request):Promise<string>;env(name:string):string|undefined;wakeWorker():Promise<void>;waitUntil?(promise:Promise<unknown>):void}
let adapter:RuntimeAdapter|null=null;
export function configureRuntime(value:RuntimeAdapter){adapter=value;}
export function deferWork(promise:Promise<unknown>){if(adapter?.waitUntil)adapter.waitUntil(promise);else if(typeof EdgeRuntime!=='undefined')EdgeRuntime.waitUntil(promise);else void promise;}
export class AppError extends Error {
  constructor(public code: string, public status = 500, public retryable = false) { super(code); }
}
export function env(name: string, fallback = ''): string { return (adapter?adapter.env(name):Deno.env.get(name)) ?? fallback; }
export function required(name: string): string {
  const value = env(name); if (!value) throw new AppError('TEMPORARILY_UNAVAILABLE',503,true); return value;
}
export const versions = Object.freeze({
  ...SEARCH_VERSIONS,
  pipelineVersion:'similar-search-v3',visionPromptVersion:'vision-attributes-v3',queryExpanderVersion:'query-v3',
  extractorVersion:'merchant-router-v3-1-jsonld1-elevenst2',rankerVersion:'ranker-v3-bootstrap-1',gateVersion:'gate-v3-bootstrap-1',
  pricePolicyVersion:'unconditional-cohort-v3',sourcePolicyVersion:'domestic-new-v3',
  dealRankerVersion:SEARCH_VERSIONS.dealRankerVersion,normalizerVersion:'magick-webp-v3-1',inputPolicyVersion:'query-nfc-controls-v3-1',
});
export async function sha256(value: string | Uint8Array): Promise<string> {
  const data=typeof value==='string'?new TextEncoder().encode(value):value;
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256',new Uint8Array(data)))].map(n=>n.toString(16).padStart(2,'0')).join('');
}
export async function boundedBody(body: ReadableStream<Uint8Array> | null, cap: number): Promise<Uint8Array> {
  if(!body) throw new AppError('INVALID_INPUT',400);
  const reader=body.getReader(); const chunks:Uint8Array[]=[]; let length=0;
  try { while(true) { const {done,value}=await reader.read(); if(done) break; length+=value.byteLength;
    if(length>cap) { await reader.cancel(); throw new AppError('IMAGE_TOO_LARGE',413); } chunks.push(value); }
  } finally { reader.releaseLock(); }
  const data=new Uint8Array(length); let offset=0; for(const c of chunks){ data.set(c,offset);offset+=c.length; } return data;
}
export async function jsonBody(req:Request,cap=8192):Promise<unknown> {
  if(req.headers.get('content-type')?.split(';')[0].trim()!=='application/json') throw new AppError('INVALID_INPUT',400);
  try{return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(await boundedBody(req.body,cap)));}
  catch(e){if(e instanceof AppError)throw e;throw new AppError('INVALID_INPUT',400);}
}
export function errorCode(e:unknown):string { return e instanceof AppError ? e.code : 'INTERNAL_ERROR'; }
// No raw requests, provider response, prompts, URLs, secrets or image bytes enter this logger.
export function audit(event:string, fields:{searchId?:string;stage?:string;code?:string;count?:number;durationMs?:number}={}) {
  console.info(JSON.stringify({event,at:new Date().toISOString(),...fields}));
}
export function internalAuth(req:Request):void {
  const secret=required('INTERNAL_WORKER_SECRET');const provided=req.headers.get('x-internal-secret')??'';
  let diff=secret.length^provided.length; for(let i=0;i<Math.max(secret.length,provided.length);i++)diff|=(secret.charCodeAt(i)||0)^(provided.charCodeAt(i)||0);
  if(diff!==0)throw new AppError('UNAUTHENTICATED',401);
}
function normalizeDbTimes(value:any):any{
  if(Array.isArray(value))return value.map(normalizeDbTimes);
  if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).map(([k,v])=>[k,
    k.endsWith('_at')&&typeof v==='string'&&Number.isFinite(Date.parse(v))?new Date(v).toISOString():normalizeDbTimes(v)]));
  return value;
}

export class Database {
  private get url(){return required('SUPABASE_URL');} private get key(){return required('SUPABASE_SERVICE_ROLE_KEY');}
  private async request(path:string,init:RequestInit={}):Promise<any>{
    const res=await fetch(`${this.url}${path}`,{...init,headers:{apikey:this.key,Authorization:`Bearer ${this.key}`,'Content-Type':'application/json',Prefer:'return=representation',...init.headers},signal:AbortSignal.timeout(8000)});
    if(!res.ok){ const body=await res.json().catch(()=>({})); const code=typeof body.message==='string'&&/^[A-Z_]+$/.test(body.message)?body.message:'TEMPORARILY_UNAVAILABLE';throw new AppError(code,503,true); }
    if(res.status===204 || res.headers.get('content-length')==='0')return null;
    return normalizeDbTimes(await res.json());
  }
  rows(table:string,query:string):Promise<Row[]>{return adapter?adapter.database.rows(table,query):this.request(`/rest/v1/${table}?${query}`);}
  async one(table:string,query:string):Promise<Row|null>{return (await this.rows(table,`${query}&limit=1`))[0]??null;}
  async insert(table:string,row:Row):Promise<Row>{return adapter?adapter.database.insert(table,row):(await this.request(`/rest/v1/${table}`,{method:'POST',body:JSON.stringify(row)}))[0];}
  patch(table:string,query:string,row:Row):Promise<Row[]>{return adapter?adapter.database.patch(table,query,row):this.request(`/rest/v1/${table}?${query}`,{method:'PATCH',body:JSON.stringify(row)});}
  rpc(name:string,args:Row={}):Promise<any>{return adapter?adapter.database.rpc(name,args):this.request(`/rest/v1/rpc/${name}`,{method:'POST',body:JSON.stringify(args)});}
  async storageGet(key:string):Promise<Uint8Array>{
    if(adapter)return adapter.database.storageGet(key);
    const res=await fetch(`${this.url}/storage/v1/object/normalized-inputs/${key}`,{headers:{apikey:this.key,Authorization:`Bearer ${this.key}`},signal:AbortSignal.timeout(8000)});
    if(!res.ok)throw new AppError('UPLOAD_NOT_READY',409);return boundedBody(res.body,10000000);
  }
  async storagePut(key:string,bytes:Uint8Array):Promise<void>{
    if(adapter)return adapter.database.storagePut(key,bytes);
    const res=await fetch(`${this.url}/storage/v1/object/normalized-inputs/${key}`,{method:'POST',headers:{apikey:this.key,Authorization:`Bearer ${this.key}`,'Content-Type':'image/webp','x-upsert':'true'},body:new Uint8Array(bytes),signal:AbortSignal.timeout(8000)});
    if(!res.ok)throw new AppError('TEMPORARILY_UNAVAILABLE',503,true);
  }
  async storageDelete(key:string):Promise<void>{
    if(adapter)return adapter.database.storageDelete(key);
    const res=await fetch(`${this.url}/storage/v1/object/normalized-inputs`,{method:'DELETE',headers:{apikey:this.key,Authorization:`Bearer ${this.key}`,'Content-Type':'application/json'},body:JSON.stringify({prefixes:[key]}),signal:AbortSignal.timeout(8000)});
    if(!res.ok)throw new AppError('TEMPORARILY_UNAVAILABLE',503,true);
  }
  async signedInput(key:string,seconds:number):Promise<string>{
    if(adapter)return adapter.database.signedInput(key,seconds);
    const value=await this.request(`/storage/v1/object/sign/normalized-inputs/${key}`,{method:'POST',body:JSON.stringify({expiresIn:seconds})});
    return `${this.url}/storage/v1${value.signedURL}`;
  }
}
export async function owner(req:Request):Promise<string>{
  if(adapter)return adapter.owner(req);
  const auth=req.headers.get('authorization');if(!auth?.startsWith('Bearer '))throw new AppError('UNAUTHENTICATED',401);
  // Auth server verifies signature, issuer, audience and expiry; unsigned JWT decoding is never trusted.
  const res=await fetch(`${required('SUPABASE_URL')}/auth/v1/user`,{headers:{apikey:required('SUPABASE_ANON_KEY'),Authorization:auth},signal:AbortSignal.timeout(5000)});
  if(!res.ok)throw new AppError('UNAUTHENTICATED',401);
  const user=await res.json();if(typeof user.id!=='string'||!/^[-a-f0-9]{36}$/.test(user.id))throw new AppError('UNAUTHENTICATED',401);return user.id;
}
export function wakeWorker():Promise<void>{
  if(adapter)return adapter.wakeWorker();
  // Jobs are durable before this best-effort hint. Cron recovers any missed hint.
  return fetch(`${required('SUPABASE_URL')}/functions/v1/worker`,{method:'POST',headers:{'x-internal-secret':required('INTERNAL_WORKER_SECRET')},signal:AbortSignal.timeout(1000)})
    .then(()=>{}).catch(()=>{});
}
