import {afterEach,describe,expect,it,vi} from 'vitest';
// SYNTHETIC ONLY: these tests stub the automatic verifier and HTTP transport.
// They do not establish a real provider token bound or authorize paid execution.
const providerPath='../../../supabase/shared/providers/openai.ts';
const {OpenAIProvider,quoteCost,usageCost,requireVerifiedInputBound,conservativeContextVerifier,serializeProviderRequest,analysisJsonSchema,comparisonJsonSchema,CONTEXT_BOUND_PROFILE}=await import(providerPath);
const hash=async(value:string)=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value)))].map(n=>n.toString(16).padStart(2,'0')).join('');
const rates=()=>({model:'gpt-6.1-sol',serviceTier:'default',processing:'global',inputMicrousdPerMillion:2_000_000,cachedInputMicrousdPerMillion:100_000,
  cacheWriteMicrousdPerMillion:2_500_000,outputMicrousdPerMillion:10_000_000,webSearchMicrousdPerCall:10_000,
  operations:{discovery:{maxInputTokens:1000,maxOutputTokens:100,maxToolCalls:1}},version:'SYNTHETIC_PRICE_FIXTURE'});
const response=(input:number,output:number,cached=0,written=0)=>({model:'gpt-6.1-sol',service_tier:'default',status:'completed',
  usage:{input_tokens:input,output_tokens:output,input_tokens_details:{cached_tokens:cached,cache_write_tokens:written}},output:[{type:'web_search_call',status:'completed',action:{sources:[]}}]});
afterEach(()=>vi.unstubAllGlobals());

describe('Provider reservation and exact usage — SYNTHETIC',()=>{
  it('reserves all input at the higher cache-write rate and includes tool fees',()=>{
    expect(quoteCost(rates(),'discovery')).toBe(13_500);
    expect(usageCost(rates(),response(1000,100,200,300))?.actual).toBe(12_770);
  });
  it('applies the full-request long-context premiums only above 272K input',()=>{
    const configured=rates();configured.operations.discovery.maxInputTokens=272000;
    expect(quoteCost(configured,'discovery')).toBe(691_000);
    configured.operations.discovery.maxInputTokens=272001;
    expect(quoteCost(configured,'discovery')).toBe(1_371_505);
    expect(usageCost(configured,response(272000,100))?.actual).toBe(555_000);
    expect(usageCost(configured,response(272001,100))?.actual).toBe(1_099_504);
  });
  it('rounds integer arithmetic up without a floating point microdollar loss',()=>{
    const configured={...rates(),inputMicrousdPerMillion:1,cachedInputMicrousdPerMillion:0,cacheWriteMicrousdPerMillion:2,outputMicrousdPerMillion:1,webSearchMicrousdPerCall:0};
    expect(usageCost(configured,response(1,1))?.actual).toBe(1);
    expect(usageCost(rates(),response(Number.MAX_SAFE_INTEGER,Number.MAX_SAFE_INTEGER))).toBeNull();
    const extreme={...rates(),inputMicrousdPerMillion:Number.MAX_SAFE_INTEGER,cacheWriteMicrousdPerMillion:Number.MAX_SAFE_INTEGER};
    expect(()=>quoteCost(extreme,'discovery')).toThrow('COST_CONFIGURATION_UNVERIFIED');
  });
  it('retains unknown cost for missing cache usage, unexpected tier/model/tools or overlapping cache counts',()=>{
    const missing=response(1000,100);delete (missing.usage.input_tokens_details as Record<string,unknown>).cache_write_tokens;
    expect(usageCost(rates(),missing)).toBeNull();
    expect(usageCost(rates(),{...response(1000,100),service_tier:'priority'})).toBeNull();
    expect(usageCost(rates(),{...response(1000,100),model:'unverified-model'})).toBeNull();
    expect(usageCost(rates(),{...response(1000,100),output:[{type:'image_generation_call'}]})).toBeNull();
    expect(usageCost(rates(),response(1000,100,700,301))).toBeNull();
    expect(()=>quoteCost({...rates(),cacheWriteMicrousdPerMillion:2_000_000},'discovery')).toThrow('COST_CONFIGURATION_UNVERIFIED');
    expect(()=>quoteCost({...rates(),serviceTier:'auto'},'discovery')).toThrow('COST_CONFIGURATION_UNVERIFIED');
  });
});

describe('Automatic input bound admission — SYNTHETIC verifier, no live proof',()=>{
  it('does not accept a scalar cap or an operator hash list as a verifier',async()=>{
    const config={...rates(),inputBoundProofs:[{requestSha256:await hash('{}'),maxBilledInputTokens:1}]};
    await expect(requireVerifiedInputBound(config,'discovery','{}')).rejects.toThrow('COST_CONFIGURATION_UNVERIFIED');
  });
  it('binds the proof to the exact request and rejects over-budget or missing profile results',async()=>{
    const body='{"input":"synthetic","tools":[{"type":"web_search"}]}';
    const proof={requestSha256:await hash(body),maxBilledInputTokens:1000,profileVersion:'SYNTHETIC_VERIFIER_V1'};
    const verifier={verify:vi.fn(async()=>proof)};
    await expect(requireVerifiedInputBound(rates(),'discovery',body,verifier)).resolves.toBe('SYNTHETIC_VERIFIER_V1');
    await expect(requireVerifiedInputBound(rates(),'discovery',body+' ',verifier)).rejects.toThrow('COST_CONFIGURATION_UNVERIFIED');
    await expect(requireVerifiedInputBound(rates(),'discovery',body,{verify:async()=>({...proof,maxBilledInputTokens:1001})})).rejects.toThrow('COST_CONFIGURATION_UNVERIFIED');
    await expect(requireVerifiedInputBound(rates(),'discovery',body,{verify:async()=>({...proof,profileVersion:''})})).rejects.toThrow('COST_CONFIGURATION_UNVERIFIED');
  });
  it('blocks before reservation/HTTP when an arbitrary scalar cap is below the derived context bound',async()=>{
    vi.stubGlobal('Deno',{env:{get:(name:string)=>name==='PAID_EXECUTION_ENABLED'?'true':name==='OPENAI_API_KEY'?'SYNTHETIC_NOT_A_KEY':undefined}});
    const fetcher=vi.fn();vi.stubGlobal('fetch',fetcher);
    const db={one:vi.fn(async()=>({rates:rates(),rates_verified_at:'fixture',history_verified_at:'fixture',model_verified_at:'fixture'})),rpc:vi.fn()};
    const provider=new OpenAIProvider(db,{id:1,lease_token:'fixture',attempt:1},{id:'fixture'},Date.now()+20_000);
    await expect(provider.discover('합성 맨투맨',1)).rejects.toThrow('COST_CONFIGURATION_UNVERIFIED');
    expect(db.rpc).not.toHaveBeenCalled();expect(fetcher).not.toHaveBeenCalled();
  });
  it('keeps the exact proven bytes, default tier and disabled truncation on the mocked request',async()=>{
    vi.stubGlobal('Deno',{env:{get:(name:string)=>name==='PAID_EXECUTION_ENABLED'?'true':name==='OPENAI_API_KEY'?'SYNTHETIC_NOT_A_KEY':undefined}});
    const verifier={verify:vi.fn(async(body:string)=>({requestSha256:await hash(body),maxBilledInputTokens:500,profileVersion:'SYNTHETIC_ONLY'}))};
    const fetcher=vi.fn(async()=>Response.json(response(500,50)));vi.stubGlobal('fetch',fetcher);
    const db={one:vi.fn(async()=>({rates:rates(),rates_verified_at:'fixture',history_verified_at:'fixture',model_verified_at:'fixture'})),rpc:vi.fn(async()=>({}))};
    const provider=new OpenAIProvider(db,{id:1,lease_token:'fixture',attempt:1},{id:'fixture'},Date.now()+20_000,verifier);
    await expect(provider.discover('합성 맨투맨',1)).resolves.toEqual([]);
    const sent=fetcher.mock.calls[0] as unknown as [string,RequestInit];
    expect(sent[1].body).toBe(verifier.verify.mock.calls[0][0]);
    expect(JSON.parse(String(sent[1].body))).toMatchObject({model:'gpt-6.1-sol',service_tier:'default',truncation:'disabled',store:false,max_tool_calls:1,max_output_tokens:100});
    expect(db.rpc).toHaveBeenCalledWith('reserve_provider',expect.objectContaining({p_worst:13_500}));
    expect(provider.settlements[0].p_units.inputBoundProfile).toBe('SYNTHETIC_ONLY');
  });
});

const textItem={type:'input_text',text:'SYNTHETIC ONLY'};
const imageItem={type:'input_image',image_url:'https://image.example.com/synthetic.webp',detail:'high'};
const discoveryBody=()=>({instructions:'SYNTHETIC ONLY',input:[{role:'user',content:[textItem]}],tools:[{type:'web_search',search_context_size:'low'}],tool_choice:'required',include:['web_search_call.action.sources','web_search_call.results']});
function visualBody(operation:'analysis'|'comparison'){
  return{instructions:'SYNTHETIC ONLY',input:[{role:'user',content:operation==='analysis'?[textItem,imageItem]:[textItem,imageItem,textItem,imageItem]}],
    text:{format:{type:'json_schema',name:operation==='analysis'?'clothing_analysis_v3':'clothing_comparison_v3',strict:true,schema:operation==='analysis'?analysisJsonSchema:comparisonJsonSchema}}};
}
function profileRequest(operation:'analysis'|'comparison'|'discovery'){
  return JSON.parse(serializeProviderRequest(operation==='discovery'?discoveryBody():visualBody(operation),{maxOutputTokens:1024,maxToolCalls:operation==='discovery'?1:0}));
}
describe('Finite-context profile — derived bound, deterministic request validation only',()=>{
  it.each(['analysis','comparison','discovery'] as const)('reserves all context per possible %s model pass',async(operation)=>{
    const serialized=JSON.stringify(profileRequest(operation));
    expect(await conservativeContextVerifier.verify(serialized,operation)).toEqual({requestSha256:await hash(serialized),maxBilledInputTokens:operation==='discovery'?2_100_000:1_050_000,profileVersion:CONTEXT_BOUND_PROFILE});
  });
  it.each([
    ['previous_response_id','resp_SYNTHETIC'],['conversation',{id:'conv_SYNTHETIC'}],['context_management',[{type:'compaction',compact_threshold:1000}]],
    ['multi_agent',{enabled:true}],['background',true],['stream',true],['prompt',{id:'pmpt_SYNTHETIC'}],['continuation','SYNTHETIC'],
  ])('rejects feature %s that is outside the reviewed stateless profile',async(key,value)=>{
    const request={...profileRequest('discovery'),[String(key)]:value};
    await expect(conservativeContextVerifier.verify(JSON.stringify(request),'discovery')).rejects.toThrow('COST_CONFIGURATION_UNVERIFIED');
  });
  it.each([
    ['max_tool_calls',2],['parallel_tool_calls',true],['truncation','auto'],['service_tier','fast'],['model','other-model'],
    ['reasoning',{effort:'low',mode:'pro'}],['reasoning',{effort:'max'}],['max_output_tokens',128001],
    ['tools',[{type:'function',name:'synthetic',parameters:{}}]],['tools',[{type:'web_search',search_context_size:'low',return_token_budget:'unlimited'}]],
    ['input',[{type:'function_call_output',call_id:'synthetic',output:'previous state'}]],
  ])('rejects unsafe %s settings before creating a cost proof',async(key,value)=>{
    const request={...profileRequest('discovery'),[String(key)]:value};
    await expect(conservativeContextVerifier.verify(JSON.stringify(request),'discovery')).rejects.toThrow('COST_CONFIGURATION_UNVERIFIED');
  });
  it('rejects extra image candidates and injected prior messages instead of relying on prompt instructions',async()=>{
    const request=profileRequest('comparison');request.input[0].content=Array.from({length:7},()=>[textItem,imageItem]).flat();
    await expect(conservativeContextVerifier.verify(JSON.stringify(request),'comparison')).rejects.toThrow('COST_CONFIGURATION_UNVERIFIED');
    const history=profileRequest('analysis');history.input.push({role:'assistant',content:[textItem]});
    await expect(conservativeContextVerifier.verify(JSON.stringify(history),'analysis')).rejects.toThrow('COST_CONFIGURATION_UNVERIFIED');
  });
  it('writes server limits after caller fields and still rejects unsupported added capabilities',async()=>{
    const body={...discoveryBody(),model:'other-model',service_tier:'ultrafast',max_tool_calls:99,max_output_tokens:999999,parallel_tool_calls:true,truncation:'auto',reasoning:{effort:'max'}};
    const serialized=serializeProviderRequest(body,{maxOutputTokens:1024,maxToolCalls:1});
    const parsed=JSON.parse(serialized);
    expect(parsed).toMatchObject({model:'gpt-6.1-sol',service_tier:'default',max_tool_calls:1,max_output_tokens:1024,parallel_tool_calls:false,truncation:'disabled',reasoning:{effort:'low'}});
    await expect(conservativeContextVerifier.verify(serialized,'discovery')).resolves.toMatchObject({maxBilledInputTokens:2_100_000});
    await expect(conservativeContextVerifier.verify(serializeProviderRequest({...body,multi_agent:{enabled:true}},{maxOutputTokens:1024,maxToolCalls:1}),'discovery')).rejects.toThrow('COST_CONFIGURATION_UNVERIFIED');
  });
  it('uses the automatic production profile before the mocked transport with full-context reservation',async()=>{
    vi.stubGlobal('Deno',{env:{get:(name:string)=>name==='PAID_EXECUTION_ENABLED'?'true':name==='OPENAI_API_KEY'?'SYNTHETIC_NOT_A_KEY':undefined}});
    const configured=rates();configured.operations.discovery.maxInputTokens=2_100_000;
    const fetcher=vi.fn(async()=>Response.json(response(500,50)));vi.stubGlobal('fetch',fetcher);
    const db={one:vi.fn(async()=>({rates:configured,rates_verified_at:'fixture',history_verified_at:'fixture',model_verified_at:'fixture'})),rpc:vi.fn(async()=>({}))};
    const provider=new OpenAIProvider(db,{id:1,lease_token:'fixture',attempt:1},{id:'fixture'},Date.now()+20_000);
    await expect(provider.discover('합성 맨투맨',1)).resolves.toEqual([]);
    expect(db.rpc).toHaveBeenCalledWith('reserve_provider',expect.objectContaining({p_worst:10_511_500}));
    expect(provider.settlements[0].p_units.inputBoundProfile).toBe(CONTEXT_BOUND_PROFILE);
  });
});
