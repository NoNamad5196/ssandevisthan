import { isTerminalStatus,RunFailureCodeSchema } from '@ssandevisthan/contracts';
import {
  compareAttributesAndVisual,rankImageCandidates,rankDealCandidates,projectSnapshot,deduplicateDiscovery,selectDiverseCandidates,
  deriveDealRelevanceInput,type Candidate,type DealCandidate,type DiscoveryCandidate,
} from '@ssandevisthan/search-core';
import {AppError,Database,audit,sha256,type Row} from './runtime.ts';
import {OpenAIProvider} from './providers/openai.ts';
import {extractCandidate} from './extractors/generic.ts';
import {extractElevenstCandidate} from './extractors/elevenst.ts';
import {SafeFetcher} from './safe-fetch.ts';
import {normalizeImage} from './images.ts';

const warning=(code:string,message='일부 판매처 또는 후보를 확인하지 못했어요.')=>({code,message});
const next=(key:string,stage:string,checkpoint:Row={})=>({key,stage,checkpoint});
function sourceFetcher(db:Database,job:Row){return new SafeFetcher(undefined,undefined,{async enter(host){
  const token=await db.rpc('claim_source',{p_job:job.id,p_token:job.lease_token,p_attempt:job.attempt,p_host:host});if(!token)return null;
  return async()=>{await db.patch('source_leases',`host=eq.${encodeURIComponent(host)}&token=eq.${token}`,{expires_at:new Date(0).toISOString()});};
}});}
function imageDataUrl(bytes:Uint8Array){let binary='';for(let i=0;i<bytes.length;i+=32768)binary+=String.fromCharCode(...bytes.subarray(i,i+32768));return`data:image/webp;base64,${btoa(binary)}`;}
function safeFailure(code:string){
  const parsed=RunFailureCodeSchema.safeParse(code);
  return{code:parsed.success?parsed.data:'PROVIDER_UNAVAILABLE',message:code==='AMBIGUOUS_TARGET'?'옷 한 벌이 잘 보이는 사진을 선택해 주세요.':code==='UNSUPPORTED_CATEGORY'?'의류 사진으로 다시 검색해 주세요.':'검색을 완료하지 못했어요. 잠시 후 다시 시도해 주세요.',retryable:!['AMBIGUOUS_TARGET','UNSUPPORTED_CATEGORY'].includes(code)};
}
export async function rankPayload(db:Database,run:Row,forcedPartial=false):Promise<Row>{
  const rows=await db.rows('search_candidates',`search_id=eq.${run.id}&snapshot=not.is.null&order=created_at.asc,id.asc`);
  const candidates=rows.map(r=>r.snapshot).filter(Boolean);
  const snapshot=run.mode==='IMAGE_SIMILAR'?rankImageCandidates(candidates as Candidate[],Date.now()):rankDealCandidates(candidates as DealCandidate[],Date.now());
  const projection=projectSnapshot(snapshot,'RECOMMENDED',run.result_limit);
  const failed=run.warning_codes.some((w:Row)=>['PROVIDER_FAILED','EXTRACTION_FAILED','COMPARISON_FAILED','DISCOVERY_FAILED','BUDGET_LIMITED'].includes(w.code));
  const partial=forcedPartial||run.warning_codes.length>0;
  const expired=forcedPartial||Date.parse(run.deadline_at)<=Date.now();
  const terminal=snapshot.eligible.length?(partial?'PARTIAL':'COMPLETED'):expired?'EXPIRED':failed?'FAILED':'NO_RELIABLE_MATCH';
  return{terminal,eligible:snapshot.eligible,references:snapshot.references,sortOrders:snapshot.sortOrders,results:projection.results,
    failure:terminal==='EXPIRED'?safeFailure('DEADLINE_EXCEEDED'):terminal==='FAILED'?safeFailure('PROVIDER_UNAVAILABLE'):null,
    warnings:!snapshot.eligible.length&&!failed&&!expired?[warning('NO_CANDIDATE_PASSED','충분히 비슷하고 가격을 확인할 수 있는 상품을 찾지 못했어요.')]:[],
    candidateUpdates:snapshot.diagnostics.map(d=>({id:rows.find(r=>r.snapshot?.offerId===d.offerId)?.id,gateStatus:'REJECT',rejectReasons:d.reasons})).filter(d=>d.id)};
}
async function signedInput(db:Database,run:Row,deadline:number):Promise<string>{
  const u=await db.one('upload_sessions',`id=eq.${run.upload_id}&owner_id=eq.${run.owner_id}&deleted_at=is.null`);
  if(!u?.object_key||Date.parse(u.expires_at)<=deadline)throw new AppError('UPLOAD_EXPIRED',410);
  return db.signedInput(u.object_key,Math.max(1,Math.min(20,Math.floor((deadline-Date.now())/1000))));
}
export async function processJob(db:Database,job:Row):Promise<void>{
  const started=Date.now();const run=await db.one('search_runs',`id=eq.${job.search_id}&deleted_at=is.null`);
  if(!run||isTerminalStatus(run.status))return;
  const deadline=Math.min(Date.parse(run.deadline_at),Date.parse(job.lease_expires_at));
  const provider=new OpenAIProvider(db,job,run,deadline);let payload:Row;
  try{
    await db.rpc('assert_lease',{p_job:job.id,p_token:job.lease_token,p_attempt:job.attempt});
    if(Date.parse(run.deadline_at)-Date.now()<5000&&job.stage!=='RANKING')payload=await rankPayload(db,run,true);
    else payload=await stage(db,provider,run,job,deadline);
    payload.settlements=provider.settlements;
    await db.rpc('commit_search_step',{p_job:job.id,p_token:job.lease_token,p_attempt:job.attempt,p_payload:payload});
    audit('worker.step',{searchId:run.id,stage:job.stage,durationMs:Date.now()-started});
  }catch(e){
    const code=e instanceof AppError?e.code:'INTERNAL_ERROR';audit('worker.error',{searchId:run.id,stage:job.stage,code});
    // Charges can settle after cancel/lease loss, but results cannot be written by a stale worker.
    await provider.settleUncommitted().catch(()=>audit('budget.reconcile_required',{searchId:run.id,code:'SETTLEMENT_FAILED'}));
    if(code==='LEASE_LOST')return;
    try{
      const ranked=await rankPayload(db,{...run,warning_codes:[...run.warning_codes,warning('PROVIDER_FAILED')]},true);
      await db.rpc('commit_search_step',{p_job:job.id,p_token:job.lease_token,p_attempt:job.attempt,p_payload:{...ranked,terminal:ranked.eligible.length?'PARTIAL':'FAILED',failure:ranked.eligible.length?null:safeFailure(code),warnings:[warning(code.replace(/[^A-Z_]/g,'_'))],settlements:provider.settlements}});
    }catch{audit('worker.recovery_required',{searchId:run.id,code:'LATE_OR_FAILED_COMMIT'});}
  }
}
async function stage(db:Database,provider:OpenAIProvider,run:Row,job:Row,deadline:number):Promise<Row>{
  const cp=job.checkpoint??{};
  switch(job.stage){
    case 'VALIDATING':{
      if(run.mode==='IMAGE_SIMILAR')return{nextJobs:[next('analyze','ANALYZING')]};
      deriveDealRelevanceInput(run.query_text,'',run.input_descriptor.category); // Fail unknown category before paid discovery.
      const query={id:crypto.randomUUID(),ordinal:1,query:run.query_text,type:'TEXT'};
      return{queries:[query],nextJobs:[next('discover:0','DISCOVERING',{cursor:0,raw:[]})]};
    }
    case 'ANALYZING':{
      const analyzed=await provider.analyze(await signedInput(db,run,deadline));
      if(!analyzed.supported)throw new AppError('UNSUPPORTED_CATEGORY',422);
      if(analyzed.ambiguousTarget)throw new AppError('AMBIGUOUS_TARGET',422);
      const queries=analyzed.generatedQueries.map((query,idx)=>({id:crypto.randomUUID(),ordinal:idx+1,query,type:idx<2?'BROAD':'DETAIL'}));
      return{targetAttributes:analyzed.targetAnalysis,queries,nextJobs:[next('discover:0','DISCOVERING',{cursor:0,raw:[]})]};
    }
    case 'DISCOVERING':{
      const queries=await db.rows('search_queries',`search_id=eq.${run.id}&order=ordinal.asc`);const cursor=Number(cp.cursor??0);
      // One paid query per durable checkpoint: known usage settles atomically
      // before the next query reserves its conservative full-context bound.
      const selected=queries.slice(cursor,cursor+1);const outcomes=await Promise.allSettled(selected.map(q=>provider.discover(q.query_text,q.ordinal)));
      const raw:Row[]=[...(cp.raw??[])];const warnings:Row[]=[];let budgetStopped=false;
      for(let i=0;i<outcomes.length;i++){const outcome=outcomes[i];if(outcome.status==='fulfilled')raw.push(...outcome.value.map(x=>({...x,queryOrdinal:selected[i].ordinal,queryId:selected[i].id})));
        else{budgetStopped=outcome.reason instanceof AppError&&outcome.reason.code==='BUDGET_LIMITED';warnings.push(warning(budgetStopped?'BUDGET_LIMITED':'DISCOVERY_FAILED'));}}
      // Bound raw records in deterministic query round-robin before deduplication.
      const round:Row[]=[];const ordinals=[...new Set(raw.map(r=>r.queryOrdinal))].sort((a,b)=>a-b);
      const queues=ordinals.map(o=>raw.filter(r=>r.queryOrdinal===o).sort((a,b)=>a.rank-b.rank));
      for(let i=0;round.length<150&&queues.some(q=>q[i]);i++)for(const q of queues)if(q[i]&&round.length<150)round.push(q[i]);
      const nextCursor=cursor+selected.length;
      if(!budgetStopped&&nextCursor<queries.length&&Date.parse(run.deadline_at)-Date.now()>40000)return{warnings,progress:{discoveredUrls:round.length},nextJobs:[next(`discover:${nextCursor}`,'DISCOVERING',{cursor:nextCursor,raw:round})]};
      if(!budgetStopped&&nextCursor<queries.length)warnings.push(warning('DEADLINE_COVERAGE','남은 처리 시간 안에서 확인 가능한 후보를 비교해요.'));
      const dedup=deduplicateDiscovery(round.map(r=>({url:r.url,queryOrdinal:r.queryOrdinal,discoveryRank:r.rank,merchant:new URL(r.url).hostname,categorySuitable:null,knownAttributeCount:0})));
      const discoveries=await Promise.all(dedup.map(async d=>{const source=round.find(r=>r.url===d.url)!;return{id:crypto.randomUUID(),url:d.url,urlHash:await sha256(d.url),queryId:source.queryId,providerResponseId:source.providerResponseId,rank:source.rank,discoveredAt:new Date().toISOString()};}));
      return{discoveries,warnings,progress:{discoveredUrls:round.length,deduplicatedUrls:dedup.length},nextJobs:[next('extract:0','EXTRACTING',{cursor:0})]};
    }
    case 'EXTRACTING':{
      const all=await db.rows('search_candidates',`search_id=eq.${run.id}&order=created_at.asc,id.asc`);
      const pool=selectDiverseCandidates<Row & DiscoveryCandidate>(all.map((c,i)=>({...c,url:c.canonical_url,queryOrdinal:1,discoveryRank:i+1,merchant:new URL(c.canonical_url).hostname,categorySuitable:null,knownAttributeCount:0})),30);
      const cursor=Number(cp.cursor??0);const batch=pool.slice(cursor,cursor+2);const records:Row[]=[],updates:Row[]=[],warnings:Row[]=[];
      // Every page, redirect, and CDN image request obtains its own host lease.
      const fetcher=sourceFetcher(db,job);
      for(const c of batch){
        try{
          const parsedUrl=new URL(c.canonical_url);
          const extractor=parsedUrl.hostname==='www.11st.co.kr'&&/^\/products\/\d+\/?$/.test(parsedUrl.pathname)?extractElevenstCandidate:extractCandidate;
          const candidate=await extractor({searchId:run.id,candidateId:c.id,url:c.canonical_url,deadline},fetcher);
          if(run.mode==='DEAL_TEXT'){
            candidate.relevance=deriveDealRelevanceInput(run.query_text,candidate.title,run.input_descriptor.category);
            candidate.dealEvidence={normalPrice:candidate.itemPrice,verifiedMerchantPrice:candidate.itemPrice,claimedCommunityPrice:null,conditionalPrices:[],conditions:[],verifiedAt:candidate.priceObservedAt,dealLabel:'PRICE_DISCOVERY'};
          }
          records.push(candidate);
        }catch(e){const code=e instanceof AppError?e.code:'EXTRACTION_FAILED';updates.push({id:c.id,metadataStatus:['BLOCKED','RATE_LIMITED'].includes(code)?'BLOCKED':'FAILED',rejectReasons:[code]});warnings.push(warning('EXTRACTION_FAILED'));}
      }
      const count=all.filter(c=>c.snapshot).length+records.length;const nextCursor=cursor+batch.length;
      const more=nextCursor<pool.length&&Date.parse(run.deadline_at)-Date.now()>25000;
      if(nextCursor<pool.length&&!more)warnings.push(warning('DEADLINE_COVERAGE'));
      return{records,candidateUpdates:updates,warnings,progress:{extractedCandidates:count},nextJobs:[more?next(`extract:${nextCursor}`,'EXTRACTING',{cursor:nextCursor}):next(run.mode==='IMAGE_SIMILAR'?'compare:0':'rank',run.mode==='IMAGE_SIMILAR'?'COMPARING':'RANKING',{cursor:0})]};
    }
    case 'COMPARING':{
      const all=await db.rows('search_candidates',`search_id=eq.${run.id}&snapshot=not.is.null&order=created_at.asc,id.asc`);
      const selected=selectDiverseCandidates<Row & DiscoveryCandidate>(all.map((c,i)=>({...c,url:c.canonical_url,queryOrdinal:1,discoveryRank:i+1,merchant:new URL(c.canonical_url).hostname,categorySuitable:null,knownAttributeCount:0})),20);
      const cursor=Number(cp.cursor??0),batch=selected.slice(cursor,cursor+5);
      if(!batch.length)return{nextJobs:[next('rank','RANKING')]};
      const prepared:Row[]=[],failed:Row[]=[],fetcher=sourceFetcher(db,job);
      for(const c of batch){try{
        const image=await fetcher.get(c.snapshot.imageUrl,'image',deadline);
        if(await sha256(image.bytes)!==c.snapshot.imageHash)throw new AppError('IMAGE_EVIDENCE_CHANGED',422);
        const normalized=await normalizeImage(image.bytes,image.headers.get('content-type')!.split(';')[0].trim().toLowerCase());
        prepared.push({candidateId:c.id,imageUrl:imageDataUrl(normalized.bytes)});
      }catch{failed.push({id:c.id,gateStatus:'REJECT',rejectReasons:['IMAGE_UNVERIFIED']});}}
      // Only exact, revalidated bytes are passed. Ephemeral data URLs never enter
      // the persisted candidate, provider audit, checkpoint, or operational log.
      const result=prepared.length?await provider.compare(await signedInput(db,run,deadline),prepared,cursor/5+1):{candidates:[]};
      const updates=result.candidates.map(compared=>{
        const old=batch.find(c=>c.id===compared.candidateId)!;const c=old.snapshot;
        const metrics=compareAttributesAndVisual(run.target_attributes,compared.attributes,compared.visual);
        return{id:old.id,snapshot:{...c,comparison:metrics,eligibility:{...c.eligibility,isClothing:compared.attributes.category.state==='OBSERVED'?true:null},matchedAttributes:compared.matchedAttributes,differentAttributes:compared.differentAttributes,unknownAttributes:compared.unknownAttributes}};
      });
      const nextCursor=cursor+batch.length;const more=nextCursor<selected.length&&Date.parse(run.deadline_at)-Date.now()>20000;
      return{candidateUpdates:[...updates,...failed],progress:{comparedCandidates:all.filter(c=>c.snapshot?.comparison).length+updates.length},warnings:[...(failed.length?[warning('COMPARISON_FAILED')]:[]),...(nextCursor<selected.length&&!more?[warning('DEADLINE_COVERAGE')]:[])],nextJobs:[more?next(`compare:${nextCursor}`,'COMPARING',{cursor:nextCursor}):next('rank','RANKING')]};
    }
    case 'RANKING':return rankPayload(db,run);
    default:throw new AppError('INTERNAL_ERROR',500);
  }
}
