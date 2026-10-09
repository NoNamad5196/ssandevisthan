import {describe,it,expect,vi,afterEach} from 'vitest';
import {rankPayload,processJob} from '../../../supabase/shared/pipeline.ts';
import {OpenAIProvider} from '../../../supabase/shared/providers/openai.ts';
import {AppError} from '../../../supabase/shared/runtime.ts';
const db={rows:async()=>[]} as any;
const run={id:'fixture',mode:'IMAGE_SIMILAR',result_limit:10,warning_codes:[],deadline_at:new Date(Date.now()+90000).toISOString()};
describe('terminal state distinguishes incomplete deadline coverage from a reliable empty result',()=>{
 it('reports NO_RELIABLE_MATCH only for a completed reliable empty pool',async()=>{expect((await rankPayload(db,run)).terminal).toBe('NO_RELIABLE_MATCH');});
 it('reports EXPIRED for deadline budget exhaustion without recommendations',async()=>{const r=await rankPayload(db,run,true);expect(r.terminal).toBe('EXPIRED');expect(r.failure.code).toBe('DEADLINE_EXCEEDED');expect(r.warnings).toEqual([]);});
 it('recognizes an elapsed absolute deadline without a caller hint',async()=>{expect((await rankPayload(db,{...run,deadline_at:new Date(0).toISOString()})).terminal).toBe('EXPIRED');});
});
describe('sequential paid discovery checkpoints (mocked provider, no LIVE call)',()=>{
 afterEach(()=>vi.restoreAllMocks());
 const active={...run,status:'RUNNING',deadline_at:new Date(Date.now()+90000).toISOString()};
 function fixture(){const committed:any[]=[];return{committed,db:{one:async()=>active,rows:async()=>[1,2,3].map(ordinal=>({id:crypto.randomUUID(),ordinal,query_text:`query ${ordinal}`})),rpc:async(name:string,args:any)=>{if(name==='commit_search_step')committed.push(args.p_payload);}} as any,job:{id:1,search_id:active.id,stage:'DISCOVERING',attempt:1,lease_token:crypto.randomUUID(),lease_expires_at:new Date(Date.now()+20000).toISOString(),checkpoint:{cursor:0,raw:[]}}};}
 it('issues one query and settles known usage in the same commit that schedules the next query',async()=>{
  const spy=vi.spyOn(OpenAIProvider.prototype,'discover').mockImplementation(async function(this:OpenAIProvider){this.settlements.push({p_key:'discovery:1',p_actual:12345});return[];});
  const f=fixture();await processJob(f.db,f.job);expect(spy).toHaveBeenCalledTimes(1);
  expect(f.committed[0].nextJobs[0]).toMatchObject({key:'discover:1',stage:'DISCOVERING',checkpoint:{cursor:1}});
  expect(f.committed[0].settlements).toEqual([{p_key:'discovery:1',p_actual:12345}]);
 });
 it('stops discovery on insufficient reserved headroom and keeps the verified pipeline available',async()=>{
  const spy=vi.spyOn(OpenAIProvider.prototype,'discover').mockRejectedValue(new AppError('BUDGET_LIMITED',429));
  const f=fixture();await processJob(f.db,f.job);expect(spy).toHaveBeenCalledTimes(1);
  expect(f.committed[0].nextJobs[0]).toMatchObject({stage:'EXTRACTING'});
  expect(f.committed[0].warnings.map((w:any)=>w.code)).toEqual(['BUDGET_LIMITED']);
 });
});
