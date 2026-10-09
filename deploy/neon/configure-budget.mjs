import {build} from 'esbuild';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import pg from 'pg';

// Reviewed official Standard/global snapshot; stale snapshots require a code review.
export const rateSnapshot={model:'gpt-6.1-sol',serviceTier:'default',processing:'global',inputMicrousdPerMillion:2000000,cachedInputMicrousdPerMillion:100000,cacheWriteMicrousdPerMillion:2500000,outputMicrousdPerMillion:10000000,webSearchMicrousdPerCall:10000,
 operations:{analysis:{maxInputTokens:1050000,maxOutputTokens:4000,maxToolCalls:0},discovery:{maxInputTokens:2100000,maxOutputTokens:1000,maxToolCalls:1},comparison:{maxInputTokens:1050000,maxOutputTokens:8000,maxToolCalls:0}},version:'openai-standard-global-2026-10-09-v1'};
export function parseUsd(value){
 if(typeof value!=='string'||!/^\d{1,9}(?:\.\d{1,6})?$/.test(value))throw Error('HISTORICAL_TOTAL_USD_INVALID');
 const [whole,fraction='']=value.split('.');return Number(BigInt(whole)*1000000n+BigInt(fraction.padEnd(6,'0')));
}
export async function applyInitialBudget(client,historicalTotalMicrousd,rates,minimum){
 await client.query('BEGIN');try{
  const previous=(await client.query('SELECT * FROM public.pilot_budget WHERE id=true FOR UPDATE')).rows[0];
  if(!previous||previous.enabled)throw Error('PAID_EXECUTION_MUST_REMAIN_DISABLED');
  if(previous.history_verified_at)throw Error('HISTORY_ALREADY_VERIFIED_RECONCILE_SEPARATELY');
  if(!Number.isSafeInteger(historicalTotalMicrousd)||historicalTotalMicrousd<Number(previous.spent_microusd))throw Error('CANNOT_REDUCE_RECORDED_SPEND');
  const ceiling=Math.min(Number(previous.search_ceiling_microusd??20000000),20000000);
  if(!Number.isSafeInteger(minimum)||minimum<=0||minimum>ceiling)throw Error('SEARCH_CEILING_BELOW_REQUIRED_FLOOR');
  // No reservation, global ceiling, quota verification, key or enabled flag is changed.
  await client.query(`UPDATE public.pilot_budget SET spent_microusd=$1,history_verified_at=now(),rates=$2,rates_verified_at=now(),model_verified_at=now(),search_ceiling_microusd=$3,minimum_search_reservation_microusd=$4,updated_at=now() WHERE id=true`,[historicalTotalMicrousd,JSON.stringify(rates),ceiling,minimum]);
  await client.query('COMMIT');
 }catch(e){await client.query('ROLLBACK');throw e;}
}
async function main(){
 const args=process.argv.slice(2);let supplied,apply=false;
 for(let i=0;i<args.length;i++){if(args[i]==='--apply')apply=true;else if(args[i]==='--historical-total-usd'&&args[i+1]!==undefined)supplied=args[++i];else throw Error('USAGE: [--historical-total-usd <confirmed cumulative USD>] [--apply]');}
 const historical=supplied===undefined?null:parseUsd(supplied),root=resolve(import.meta.dirname,'../..');
 const bundle=await build({stdin:{contents:"export {quoteCost} from './supabase/shared/providers/openai.ts';",resolveDir:root},bundle:true,platform:'node',format:'esm',write:false,logLevel:'silent'});
 const {quoteCost}=await import('data:text/javascript;base64,'+Buffer.from(bundle.outputFiles[0].contents).toString('base64'));
 const quotes=Object.fromEntries(['analysis','discovery','comparison'].map(operation=>[operation,quoteCost(rateSnapshot,operation)])),minimum=Math.max(...Object.values(quotes));
 const plan={mode:apply?'APPLY_INITIAL_HISTORY_DISABLED':'DRY_RUN_NO_NETWORK_NO_WRITE',historicalTotalMicrousd:historical,rates:rateSnapshot,operationReservationsMicrousd:quotes,minimumSearchReservationMicrousd:minimum,paidExecutionWillBeEnabled:false,quotaVerificationWillChange:false};
 if(!apply){console.info(JSON.stringify(plan,null,2));return;}
 if(historical===null)throw Error('CONFIRMED_HISTORICAL_TOTAL_REQUIRED');
 if(new Date().toISOString().slice(0,10)!=='2026-10-09')throw Error('RATE_SNAPSHOT_EXPIRED_REVIEW_OFFICIAL_PRICING');
 if(!process.env.DATABASE_URL||!process.env.OPENAI_API_KEY)throw Error('SERVER_DATABASE_AND_OPENAI_CREDENTIALS_REQUIRED');
 // Read-only model metadata; never Responses/input_tokens or any billed generation.
 const model=await fetch('https://api.openai.com/v1/models/'+rateSnapshot.model,{headers:{Authorization:'Bearer '+process.env.OPENAI_API_KEY},signal:AbortSignal.timeout(10000)});
 if(!model.ok||(await model.json()).id!==rateSnapshot.model)throw Error('EXACT_MODEL_UNAVAILABLE');
 const client=new pg.Client({connectionString:process.env.DATABASE_URL});try{await client.connect();await applyInitialBudget(client,historical,rateSnapshot,minimum);}finally{await client.end().catch(()=>{});}
 console.info(JSON.stringify({...plan,applied:true}));
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))main().catch(e=>{console.error(/^[A-Z][A-Z0-9_ :<>\[\]-]+$/.test(e.message??'')?e.message:'BUDGET_CONFIGURATION_FAILED');process.exitCode=1;});
