import {
  API_BASE, CreateUploadRequestSchema, FinalizeUploadRequestSchema, CreateSearchRequestSchema,
  CreateDealRequestSchema, IdempotencyKeySchema, UuidSchema, SortSchema, HistoryQuerySchema,
  isTerminalStatus, SearchResultsDataSchema, SearchStatusDataSchema,
} from '@ssandevisthan/contracts';
import { AppError, Database, audit, boundedBody, deferWork, env, jsonBody, owner, sha256, versions, wakeWorker, type Row } from '../../shared/runtime.ts';
import { normalizeImage } from '../../shared/images.ts';
import {rankPayload} from '../../shared/pipeline.ts';

const messages:Record<string,string>={
  INVALID_INPUT:'요청 내용을 확인해 주세요.',INVALID_SCHEMA_VERSION:'지원하지 않는 요청 형식이에요.',
  INVALID_IMAGE:'이미지 파일을 읽을 수 없어요. JPG, PNG, WEBP 사진 한 장을 선택해 주세요.',
  UNAUTHENTICATED:'세션을 확인할 수 없어요. 새로고침 후 다시 시도해 주세요.',
  NOT_FOUND:'요청한 항목을 찾을 수 없어요.',TEMPORARILY_UNAVAILABLE:'서비스 연결을 준비하고 있어요. 잠시 후 다시 시도해 주세요.',
  RATE_LIMITED:'진행 중인 검색을 기다린 후 다시 시도해 주세요.',BUDGET_LIMITED:'검색 사용 한도에 도달했어요.',
  UPLOAD_NOT_READY:'사진 업로드를 먼저 완료해 주세요.',UPLOAD_PROCESSING:'사진을 처리하고 있어요.',
  UPLOAD_CONTENT_CHANGED:'이 업로드에는 다른 사진을 사용할 수 없어요.',UPLOAD_ALREADY_CONSUMED:'새 검색에는 사진을 다시 업로드해 주세요.',
  UPLOAD_IN_USE:'사용 중인 검색을 먼저 취소하거나 삭제해 주세요.',UPLOAD_EXPIRED:'사진 보관 시간이 지났어요. 다시 업로드해 주세요.',
  SEARCH_DELETED:'삭제한 검색이에요.',SEARCH_EXPIRED:'검색 보관 시간이 지났어요.',IDEMPOTENCY_KEY_REUSED:'같은 요청 키에 다른 검색 내용이 사용되었습니다.',
  IMAGE_TOO_LARGE:'10MB 이하의 사진을 선택해 주세요.',IMAGE_DIMENSIONS_EXCEEDED:'2,400만 화소 이하의 사진을 선택해 주세요.',
  UNSUPPORTED_MEDIA_TYPE:'JPG, PNG, WEBP 파일을 선택해 주세요.',UNSUPPORTED_SORT_FOR_MODE:'텍스트 검색은 이 정렬을 지원하지 않아요.',
  INTERNAL_ERROR:'요청을 처리하지 못했어요. 잠시 후 다시 시도해 주세요.',
};
const errorStatus:Record<string,number>={INVALID_INPUT:400,INVALID_SCHEMA_VERSION:400,INVALID_IMAGE:400,UNSUPPORTED_SORT_FOR_MODE:400,
  UNAUTHENTICATED:401,NOT_FOUND:404,IDEMPOTENCY_KEY_REUSED:409,UPLOAD_ALREADY_CONSUMED:409,UPLOAD_NOT_READY:409,UPLOAD_CONTENT_CHANGED:409,UPLOAD_PROCESSING:409,UPLOAD_IN_USE:409,
  UPLOAD_EXPIRED:410,SEARCH_DELETED:410,SEARCH_EXPIRED:410,IMAGE_TOO_LARGE:413,IMAGE_DIMENSIONS_EXCEEDED:413,UNSUPPORTED_MEDIA_TYPE:415,RATE_LIMITED:429,BUDGET_LIMITED:429,FREE_QUOTA_EXHAUSTED:429,TEMPORARILY_UNAVAILABLE:503};
function parse<T>(schema:{safeParse(v:unknown):{success:true;data:T}|{success:false}},value:unknown):T{
  const parsed=schema.safeParse(value);if(!parsed.success){if(typeof value==='object'&&value!==null&&'schemaVersion' in value&&(value as Row).schemaVersion!==3)throw new AppError('INVALID_SCHEMA_VERSION',400);throw new AppError('INVALID_INPUT',400);}return parsed.data;
}
function statusData(r:Row){return SearchStatusDataSchema.parse({searchId:r.id,mode:r.mode,status:r.status,stage:r.stage,createdAt:r.created_at,deadlineAt:r.deadline_at,
  completedAt:r.completed_at,pollAfterMs:isTerminalStatus(r.status)?0:3000,progress:r.progress,failure:r.failure});}
async function getRun(db:Database,uid:string,id:string):Promise<Row>{
  let r=await db.one('search_runs',`id=eq.${id}&owner_id=eq.${uid}&deleted_at=is.null`);
  if(!r)throw new AppError('NOT_FOUND',404);if(Date.parse(r.expires_at)<=Date.now())throw new AppError('SEARCH_EXPIRED',410);
  if(!isTerminalStatus(r.status)&&Date.parse(r.deadline_at)<=Date.now()){await db.rpc('recover_terminal',{p_search:r.id,p_payload:await rankPayload(db,r,true)});r=await db.one('search_runs',`id=eq.${id}&owner_id=eq.${uid}&deleted_at=is.null`);if(!r)throw new AppError('NOT_FOUND',404);}
  return r;
}
export async function handleApi(req:Request):Promise<Response>{
  const requestId=UuidSchema.safeParse(req.headers.get('x-request-id')).success?req.headers.get('x-request-id')!:crypto.randomUUID();
  const meta={requestId,schemaVersion:3 as const,createdAt:new Date().toISOString()};
  const origin=req.headers.get('origin');const origins=env('CORS_ORIGINS').split(',').map(x=>x.trim()).filter(Boolean);
  const headers:Record<string,string>={'Content-Type':'application/json; charset=utf-8','Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff','X-Request-Id':requestId,Vary:'Origin'};
  const respond=(data:unknown,status=200,extra:Record<string,string>={})=>new Response(JSON.stringify({ok:true,data,meta}),{status,headers:{...headers,...extra}});
  if(origin&&origins.includes(origin))Object.assign(headers,{'Access-Control-Allow-Origin':origin,'Access-Control-Allow-Methods':'GET,POST,PUT,DELETE,OPTIONS','Access-Control-Allow-Headers':'Authorization,Content-Type,Idempotency-Key,X-Request-Id,apikey','Access-Control-Expose-Headers':'Location,Retry-After,X-Request-Id','Access-Control-Max-Age':'600'});
  try{
    if(origin&&!origins.includes(origin))throw new AppError('UNAUTHENTICATED',401);
    if(req.method==='OPTIONS')return new Response(null,{status:204,headers});
    const url=new URL(req.url);const path=url.pathname.replace(/^\/api\/v3/,API_BASE);
    if(!path.startsWith(`${API_BASE}/`))throw new AppError('NOT_FOUND',404);
    const uid=await owner(req);const db=new Database();const relative=path.slice(API_BASE.length);
    if(req.method==='POST'&&relative==='/uploads'){
      const body=parse(CreateUploadRequestSchema,await jsonBody(req));
      const r=await db.rpc('create_upload',{p_owner:uid,p_mime:body.declaredMimeType,p_bytes:body.declaredBytes});
      return respond({uploadId:r.id,status:'PENDING',contentUrl:`${API_BASE}/uploads/${r.id}/content`,expiresAt:r.expires_at,maxBytes:10000000,maxPixels:24000000},201);
    }
    const upload=relative.match(/^\/uploads\/([^/]+)(?:\/(content|finalize))?$/);
    if(upload){
      const id=parse(UuidSchema,upload[1]);const action=upload[2];
      if(req.method==='DELETE'&&!action){await db.rpc('delete_upload',{p_owner:uid,p_upload:id});return new Response(null,{status:204,headers});}
      const u=await db.one('upload_sessions',`id=eq.${id}&owner_id=eq.${uid}&deleted_at=is.null`);
      if(!u)throw new AppError('NOT_FOUND',404);if(Date.parse(u.expires_at)<=Date.now())throw new AppError('UPLOAD_EXPIRED',410);
      if(req.method==='PUT'&&action==='content'){
        if(Number(req.headers.get('content-length')??0)>10000000)throw new AppError('IMAGE_TOO_LARGE',413);
        if(req.headers.get('content-type')?.split(';')[0]!==u.declared_mime)throw new AppError('INVALID_IMAGE',400);
        const bytes=await boundedBody(req.body,10000000);if(bytes.length!==u.declared_bytes)throw new AppError('INVALID_INPUT',400);
        const claimed=await db.rpc('claim_upload',{p_owner:uid,p_upload:id,p_raw_hash:await sha256(bytes)});
        let stored=claimed;
        if(claimed.status==='PROCESSING'){
          const normalized=await normalizeImage(bytes,u.declared_mime);
          const key=`${uid}/${id}/normalized.webp`;await db.storagePut(key,normalized.bytes);
          try{stored=await db.rpc('store_upload',{p_owner:uid,p_upload:id,p_token:claimed.lease_token,p_metadata:{sha256:normalized.sha256,width:normalized.width,height:normalized.height,bytes:normalized.bytes.length,version:normalized.version}});}
          catch(e){audit('upload.cleanup_pending',{code:'STORE_UPLOAD_NOT_COMMITTED'});throw e;}
        }
        return respond({uploadId:id,status:'STORED',mimeType:'image/webp',width:stored.width,height:stored.height,normalizedBytes:stored.normalized_bytes,expiresAt:stored.expires_at});
      }
      if(req.method==='POST'&&action==='finalize'){
        parse(FinalizeUploadRequestSchema,await jsonBody(req));
        if(!['STORED','READY'].includes(u.status)||!u.object_key)throw new AppError('UPLOAD_NOT_READY',409);
        const data=await db.storageGet(u.object_key);if(data.length!==u.normalized_bytes||await sha256(data)!==u.normalized_sha256)throw new AppError('UPLOAD_NOT_READY',409);
        const updated=await db.patch('upload_sessions',`id=eq.${id}&owner_id=eq.${uid}&status=in.(STORED,READY)&deleted_at=is.null&expires_at=gt.${encodeURIComponent(new Date().toISOString())}`,{status:'READY'});
        if(!updated.length)throw new AppError('UPLOAD_NOT_READY',409);
        return respond({uploadId:id,status:'READY',width:u.width,height:u.height,mimeType:'image/webp',expiresAt:u.expires_at});
      }
      throw new AppError('NOT_FOUND',404);
    }
    if(req.method==='POST'&&(relative==='/searches'||relative==='/deals')){
      const key=parse(IdempotencyKeySchema,req.headers.get('idempotency-key'));
      const image=relative==='/searches';const input=image?parse(CreateSearchRequestSchema,await jsonBody(req)):parse(CreateDealRequestSchema,await jsonBody(req));
      // Trusted ingress sets this header. Never expose or store the raw IP; HMAC changes are operator controlled.
      // Default one conservative global bucket until ingress header stripping is verified.
      const trustedHeader=env('VERIFIED_CLIENT_IP_HEADER');const ip=trustedHeader?req.headers.get(trustedHeader)??'unknown':'unknown';
      const result=await db.rpc('accept_search',{p_owner:uid,p_key_hash:await sha256(key),p_mode:image?'IMAGE_SIMILAR':'DEAL_TEXT',p_input:input,p_versions:{...versions,normalizerVersion:env('NORMALIZER_VERSION',versions.normalizerVersion)},p_ip_hash:await sha256(`${env('INTERNAL_WORKER_SECRET')}|${ip}`)});
      const r=result.run;deferWork(wakeWorker());
      return respond({searchId:r.id,mode:r.mode,status:r.status,stage:r.stage,statusUrl:`${API_BASE}/searches/${r.id}`,resultsUrl:`${API_BASE}/searches/${r.id}/results`,deadlineAt:r.deadline_at,reused:result.reused},202,{Location:`${API_BASE}/searches/${r.id}`,'Retry-After':'2'});
    }
    if(req.method==='GET'&&relative==='/searches'){
      const q=parse(HistoryQuerySchema,Object.fromEntries(url.searchParams));let filter='';
      if(q.cursor){let cursor:Row;try{cursor=JSON.parse(atob(q.cursor));}catch{throw new AppError('INVALID_INPUT',400);}const id=parse(UuidSchema,cursor.id);if(typeof cursor.createdAt!=='string'||!Number.isFinite(Date.parse(cursor.createdAt)))throw new AppError('INVALID_INPUT',400);
        const at=encodeURIComponent(new Date(cursor.createdAt).toISOString());filter=`&or=(created_at.lt.${at},and(created_at.eq.${at},id.lt.${id}))`;}
      const rows=await db.rows('search_runs',`owner_id=eq.${uid}&deleted_at=is.null&expires_at=gt.${encodeURIComponent(new Date().toISOString())}&order=created_at.desc,id.desc&limit=${q.limit+1}${filter}`);
      const shown=rows.slice(0,q.limit);const last=shown.at(-1);return respond({searches:shown.map(statusData),nextCursor:rows.length>q.limit&&last?btoa(JSON.stringify({id:last.id,createdAt:last.created_at})):null});
    }
    const search=relative.match(/^\/searches\/([^/]+)(?:\/(results|cancel))?$/);
    if(search){const id=parse(UuidSchema,search[1]),action=search[2];
      if(req.method==='DELETE'&&!action){await db.rpc('delete_search',{p_owner:uid,p_search:id});return new Response(null,{status:204,headers});}
      if(req.method==='POST'&&action==='cancel'){parse(FinalizeUploadRequestSchema,await jsonBody(req));return respond(statusData(await db.rpc('cancel_search',{p_owner:uid,p_search:id})));}
      const r=await getRun(db,uid,id);
      if(req.method==='GET'&&!action)return respond(statusData(r));
      if(req.method==='GET'&&action==='results'){
        if([...url.searchParams.keys()].some(k=>k!=='sort'))throw new AppError('INVALID_INPUT',400);
        const sort=parse(SortSchema,url.searchParams.get('sort')??'RECOMMENDED');
        if(r.mode==='DEAL_TEXT'&&sort==='MOST_SIMILAR')throw new AppError('UNSUPPORTED_SORT_FOR_MODE',400);
        if(!isTerminalStatus(r.status))return respond(statusData(r),202,{'Retry-After':'3'});
        const s=await db.one('search_rank_snapshots',`search_id=eq.${id}`);
        const byId=new Map<string,Row>((s?.eligible??[]).map((item:Row)=>[item.offerId,item]));const ranks:Record<string,number>={};
        const results:Row[]=(s?.sort_orders[sort]??[]).map((offer:string)=>byId.get(offer)).filter(Boolean).map((item:Row)=>({...item,cohortRank:ranks[item.priceBasis]=(ranks[item.priceBasis]??0)+1})).slice(0,r.result_limit);
        const common={searchId:id,mode:r.mode,status:r.status,stage:r.stage,results,references:s?.references_json??[],warnings:r.warning_codes,completedAt:r.completed_at,expiresAt:r.expires_at,sort,failure:r.failure};
        const queries=await db.rows('search_queries',`search_id=eq.${id}&order=ordinal.asc`);
        const data=SearchResultsDataSchema.parse(r.mode==='IMAGE_SIMILAR'?{...common,targetAnalysis:Object.keys(r.target_attributes).length?r.target_attributes:null,generatedQueries:queries.map(q=>q.query_text),identifiedOriginal:null}:{...common,query:r.query_text,category:r.input_descriptor.category});
        return respond(data);
      }
    }
    throw new AppError('NOT_FOUND',404);
  }catch(e){
    const raw=e instanceof AppError?e.code:'INTERNAL_ERROR';const code=messages[raw]?raw:'INTERNAL_ERROR';const status=errorStatus[code]??500;
    audit('api.error',{code});return new Response(JSON.stringify({ok:false,error:{code,message:messages[code],retryable:status>=500||status===429},meta}),{status,headers:{...headers,...(status===429?{'Retry-After':'60'}:{})}});
  }
}
if(import.meta.main)Deno.serve(handleApi);
