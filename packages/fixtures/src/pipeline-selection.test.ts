import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {createHash} from 'node:crypto';
import {fixtureCandidate,fixtureDeal,fixtureMerchantAttributes,fixtureMetrics,fixtureTarget,fixtureUuid,fixtureVisual,FIXTURE_TIME} from './index.ts';
import {rankImageCandidates} from '@ssandevisthan/search-core';

// SYNTHETIC orchestration regressions only. No merchant or model network is used.
const shared='../../../supabase/shared/';
const {processJob,rankPayload}=await import(`${shared}pipeline.ts`);
const generic=await import(`${shared}extractors/generic.ts`);
const images=await import(`${shared}images.ts`);
const {SafeFetcher}=await import(`${shared}safe-fetch.ts`);
const {OpenAIProvider}=await import(`${shared}providers/openai.ts`);
type Row=Record<string,any>;
const searchId=fixtureUuid(9001),queryId=fixtureUuid(9002),ownerId=fixtureUuid(9003);
const bytes=new Uint8Array([1,2,3]),imageHash=createHash('sha256').update(bytes).digest('hex');
const observedAt=new Date(FIXTURE_TIME).toISOString();

function candidate(index:number,rank=index):Row{
  // Deliberately reverse random-ID order versus provider discovery rank.
  const id=fixtureUuid(1000-index),snapshot:Row=fixtureCandidate(index,{comparison:null});
  snapshot.sourceVariantKey=`synthetic-option-${index}`;snapshot.imageHash=imageHash;
  snapshot.eligibility.isClothing=null;
  snapshot.fieldEvidence=snapshot.fieldEvidence.map((e:Row)=>({...e,searchId,candidateId:id}));
  for(const [fieldPath,value] of [['/condition','NEW'],['/domesticShipping','CONFIRMED'],['/domesticSales',true],['/overseasDirect',false],['/rental',false],['/stockStatus','IN_STOCK'],['/variant',snapshot.sourceVariantKey]]){
    const base=snapshot.fieldEvidence[0];snapshot.fieldEvidence.push({...base,id:fixtureUuid(10000+index*10+snapshot.fieldEvidence.length),fieldPath,value,observedAt});
  }
  snapshot.evidenceIds=snapshot.fieldEvidence.map((e:Row)=>e.id);
  return{id,search_id:searchId,canonical_url:`https://merchant.example.com/product/${index}`,created_at:observedAt,snapshot,rank};
}
function harness(candidates:Row[],stage:'EXTRACTING'|'COMPARING',cursor=0){
  const run={id:searchId,owner_id:ownerId,upload_id:fixtureUuid(9004),mode:'IMAGE_SIMILAR',status:'RUNNING',target_attributes:fixtureTarget,warning_codes:[],result_limit:10,deadline_at:new Date(FIXTURE_TIME+90_000).toISOString()};
  const records=[...candidates].sort((a,b)=>a.id.localeCompare(b.id));
  const evidence=candidates.map(c=>({id:fixtureUuid(50000+c.rank),search_id:searchId,candidate_id:c.id,field_path:'/discovery',source_url:c.canonical_url,source_kind:'SEARCH_RESULT',confidence:'VERIFIED',value_json:{rank:c.rank,queryId,providerResponseId:'synthetic-only'}}));
  const payloads:Row[]=[];
  const db={
    rows:vi.fn(async(table:string)=>table==='search_candidates'?records:table==='field_evidence'?evidence:table==='search_queries'?[{id:queryId,ordinal:1}]:[]),
    one:vi.fn(async(table:string)=>table==='search_runs'?run:table==='upload_sessions'?{object_key:'synthetic-private-input',expires_at:new Date(FIXTURE_TIME+3600_000).toISOString()}:null),
    rpc:vi.fn(async(name:string,args:Row)=>{if(name==='commit_search_step')payloads.push(args.p_payload);return null;}),
    signedInput:vi.fn(async()=> 'https://private.example.invalid/synthetic-image'),
  };
  const job={id:1,search_id:searchId,stage,checkpoint:{cursor},lease_token:fixtureUuid(9005),lease_expires_at:new Date(FIXTURE_TIME+20_000).toISOString(),attempt:1};
  return{db,job,evidence,payloads,run};
}
beforeEach(()=>{vi.useFakeTimers();vi.setSystemTime(FIXTURE_TIME);vi.spyOn(globalThis,'fetch').mockRejectedValue(new Error('SYNTHETIC_TEST_NETWORK_DISABLED'));});
afterEach(()=>{vi.restoreAllMocks();vi.useRealTimers();});

describe('Durable discovery ordering and comparison eligibility — SYNTHETIC',()=>{
  it('extracts by persisted provider rank rather than UUID or insertion order, including resumed cursors',async()=>{
    const all=Array.from({length:35},(_,i)=>candidate(i+1));
    const extract=vi.spyOn(generic,'extractCandidate').mockImplementation(async(context:unknown)=>all.find(c=>c.canonical_url===(context as Row).url)!.snapshot);
    const first=harness(all,'EXTRACTING');await processJob(first.db,first.job);
    expect(extract.mock.calls.map(([context])=>(context as Row).url)).toEqual(all.slice(0,2).map(c=>c.canonical_url));
    expect(first.payloads[0].nextJobs[0].checkpoint.cursor).toBe(2);
    extract.mockClear();const resumed=harness([...all].reverse(),'EXTRACTING',2);await processJob(resumed.db,resumed.job);
    expect(extract.mock.calls.map(([context])=>(context as Row).url)).toEqual(all.slice(2,4).map(c=>c.canonical_url));
    expect(fetch).not.toHaveBeenCalled();
  });

  it('uses canonical URL for equal provider rank, independent of candidate IDs',async()=>{
    const all=[candidate(2,1),candidate(1,1)];
    const extract=vi.spyOn(generic,'extractCandidate').mockImplementation(async()=>all[0].snapshot);
    const test=harness(all,'EXTRACTING');await processJob(test.db,test.job);
    expect(extract.mock.calls.map(([context])=>(context as Row).url)).toEqual([all[1].canonical_url,all[0].canonical_url]);
  });

  it('fails closed before extraction when immutable discovery rank evidence is missing',async()=>{
    const test=harness([candidate(1)],'EXTRACTING');test.evidence.length=0;
    const extract=vi.spyOn(generic,'extractCandidate');await processJob(test.db,test.job);
    expect(extract).not.toHaveBeenCalled();expect(test.payloads[0].terminal).toBe('FAILED');expect(fetch).not.toHaveBeenCalled();
  });

  it('does not spend the first twenty comparison slots on ineligible candidates',async()=>{
    const all=Array.from({length:25},(_,i)=>candidate(i+1));
    for(const c of all.slice(0,20)){c.snapshot.eligibility.condition='USED';}
    const get=vi.spyOn(SafeFetcher.prototype,'get').mockResolvedValue({bytes,headers:new Headers({'content-type':'image/webp'})});
    vi.spyOn(images,'normalizeImage').mockResolvedValue({bytes});
    const compare=vi.spyOn(OpenAIProvider.prototype,'compare').mockImplementation(async(_input:unknown,items:unknown)=>({candidates:(items as Row[]).map(c=>({candidateId:c.candidateId,attributes:fixtureMerchantAttributes,visual:fixtureVisual,matchedAttributes:[],differentAttributes:[],unknownAttributes:[]}))}));
    const test=harness(all,'COMPARING');await processJob(test.db,test.job);
    expect(compare).toHaveBeenCalledOnce();expect((compare.mock.calls[0][1] as Row[]).map(c=>c.candidateId)).toEqual(all.slice(20).map(c=>c.id));
    expect(get).toHaveBeenCalledTimes(5);
    expect(test.payloads[0].candidateUpdates.filter((c:Row)=>c.gateStatus==='REJECT')).toHaveLength(20);
    expect(test.payloads[0].candidateUpdates.find((c:Row)=>c.id===all[0].id).rejectReasons).toContain('NOT_NEW');
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each(['rental','domesticSales','overseasDirect','stockStatus','condition','domesticShipping'] as const)('rejects unknown %s without image download or model comparison',async field=>{
    const c=candidate(1);c.snapshot.eligibility[field]=['stockStatus','condition','domesticShipping'].includes(field)?'UNKNOWN':null;
    const get=vi.spyOn(SafeFetcher.prototype,'get'),compare=vi.spyOn(OpenAIProvider.prototype,'compare');
    const test=harness([c],'COMPARING');await processJob(test.db,test.job);
    expect(get).not.toHaveBeenCalled();expect(compare).not.toHaveBeenCalled();expect(test.payloads[0].nextJobs[0].stage).toBe('RANKING');
    expect(test.payloads[0].candidateUpdates[0].rejectReasons).toContain('ELIGIBILITY_UNKNOWN');
  });

  it.each(['missing','model-inference','other-variant','other-run','other-candidate'] as const)('requires actual bound merchant eligibility evidence: %s',async fault=>{
    const c=candidate(1),record=c.snapshot.fieldEvidence.find((e:Row)=>e.fieldPath==='/domesticSales');
    if(fault==='missing')c.snapshot.fieldEvidence=c.snapshot.fieldEvidence.filter((e:Row)=>e!==record);
    else if(fault==='model-inference')record.sourceKind='MODEL_INFERENCE';
    else if(fault==='other-variant')record.variantId=fixtureUuid(8001);
    else if(fault==='other-run')record.searchId=fixtureUuid(8002);
    else record.candidateId=fixtureUuid(8003);
    const compare=vi.spyOn(OpenAIProvider.prototype,'compare');const test=harness([c],'COMPARING');await processJob(test.db,test.job);
    expect(compare).not.toHaveBeenCalled();expect(test.payloads[0].candidateUpdates[0].rejectReasons).toContain('ELIGIBILITY_UNKNOWN');expect(fetch).not.toHaveBeenCalled();
  });

  it('allows a price-unknown reference candidate without inventing clothing eligibility before vision',async()=>{
    const c=candidate(1);c.snapshot.itemPrice=null;c.snapshot.priceObservedAt=null;c.snapshot.price.unconditionalPriceVerified=false;
    vi.spyOn(SafeFetcher.prototype,'get').mockResolvedValue({bytes,headers:new Headers({'content-type':'image/webp'})});
    vi.spyOn(images,'normalizeImage').mockResolvedValue({bytes});
    const compare=vi.spyOn(OpenAIProvider.prototype,'compare').mockImplementation(async()=>({candidates:[{candidateId:c.id,attributes:fixtureMerchantAttributes,visual:fixtureVisual,matchedAttributes:[],differentAttributes:[],unknownAttributes:[]}]}));
    const test=harness([c],'COMPARING');await processJob(test.db,test.job);
    expect(compare).toHaveBeenCalledOnce();expect(c.snapshot.eligibility.isClothing).toBeNull();
    expect(test.payloads[0].candidateUpdates[0].snapshot.eligibility.isClothing).toBe(true);expect(fetch).not.toHaveBeenCalled();
  });

  it('preserves final gate scores and ordering for fully evidenced candidates',async()=>{
    const all=[candidate(1),candidate(2)];
    for(const c of all){c.snapshot.comparison=fixtureMetrics();c.snapshot.eligibility.isClothing=true;}
    const expected=rankImageCandidates(all.map(c=>c.snapshot),FIXTURE_TIME);
    const test=harness(all,'COMPARING'),output=await rankPayload(test.db,test.run);
    expect(output.eligible).toEqual(expected.eligible);expect(output.references).toEqual(expected.references);
    expect(output.sortOrders).toEqual(expected.sortOrders);expect(output.terminal).toBe('COMPLETED');expect(fetch).not.toHaveBeenCalled();
  });

  it.each(['direct-ranking','deadline-recovery'] as const)('cannot revive a prior comparison without source evidence during %s',async route=>{
    const c=candidate(1);c.snapshot.comparison=fixtureMetrics();c.snapshot.eligibility.isClothing=true;
    c.snapshot.fieldEvidence=c.snapshot.fieldEvidence.filter((e:Row)=>e.fieldPath!=='/rental');
    const test=harness([c],'COMPARING');let output:Row;
    if(route==='direct-ranking')output=await rankPayload(test.db,test.run);
    else{test.run.deadline_at=new Date(FIXTURE_TIME+1000).toISOString();await processJob(test.db,test.job);output=test.payloads[0];}
    expect(output.eligible).toEqual([]);expect(output.references).toEqual([]);
    expect(output.candidateUpdates[0].rejectReasons).toContain('ELIGIBILITY_UNKNOWN');expect(fetch).not.toHaveBeenCalled();
  });

  it('keeps DEAL_TEXT eligibility independent of image-only clothing classification',async()=>{
    const c=candidate(1),deal=fixtureDeal(1);c.snapshot.eligibility.isClothing=false;
    c.snapshot.relevance=deal.relevance;c.snapshot.dealEvidence=deal.dealEvidence;
    const test=harness([c],'COMPARING');test.run.mode='DEAL_TEXT';const output=await rankPayload(test.db,test.run);
    expect(output.eligible).toHaveLength(1);expect(output.terminal).toBe('COMPLETED');expect(fetch).not.toHaveBeenCalled();
  });
});
