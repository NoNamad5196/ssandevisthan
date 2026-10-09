import {validateBackendSettings} from './settings.mjs';
// One immutable target is shared by deployment and rollback. Test branches must
// never be passed through this production command.
export const PRODUCTION_TARGET=Object.freeze({project:'lucky-sun-06718695',branch:'br-polished-resonance-az03nnva',slug:'api',database:'neondb',role:'neondb_owner'});
export async function validateRollbackTarget({connectionString,settings,apiKey},fetcher=fetch){
 validateBackendSettings(settings);
 let database;try{database=new URL(connectionString);}catch{throw Error('ROLLBACK_DATABASE_TARGET_INVALID');}
 if(!['postgres:','postgresql:'].includes(database.protocol)||!database.password||decodeURIComponent(database.username)!==PRODUCTION_TARGET.role||decodeURIComponent(database.pathname)!=='/'+PRODUCTION_TARGET.database||(database.port&&database.port!=='5432')||database.hash||
   [...database.searchParams.keys()].some(key=>!['sslmode','channel_binding'].includes(key))||['sslmode','channel_binding'].some(key=>database.searchParams.getAll(key).length>1)||
   !['require','verify-full'].includes(database.searchParams.get('sslmode')))throw Error('ROLLBACK_DATABASE_TARGET_INVALID');
 if(typeof apiKey!=='string'||apiKey.length===0)throw Error('NEON_API_KEY_REQUIRED');
 const {project,branch,slug}=PRODUCTION_TARGET,base=`https://console.neon.tech/api/v2/projects/${project}`;
 const get=async path=>{let response;try{response=await fetcher(base+path,{method:'GET',headers:{Authorization:'Bearer '+apiKey},redirect:'error',signal:AbortSignal.timeout(10000)});}catch{throw Error('ROLLBACK_TARGET_METADATA_UNAVAILABLE');}if(!response.ok)throw Error('ROLLBACK_TARGET_METADATA_UNAVAILABLE');return response.json();};
 const [endpointData,functionData,databaseData]=await Promise.all([get('/endpoints'),get(`/branches/${branch}/functions/${slug}`),get(`/branches/${branch}/databases`)]);
 const endpoint=(endpointData.endpoints??[]).find(e=>e.project_id===project&&e.branch_id===branch&&e.type==='read_write'&&typeof e.host==='string'&&
   [e.host,e.host.replace(/^([^.]+)\./,'$1-pooler.')].includes(database.hostname));
 if(!endpoint)throw Error('ROLLBACK_DATABASE_TARGET_MISMATCH');
 if(!(databaseData.databases??[]).some(d=>d.branch_id===branch&&d.name===PRODUCTION_TARGET.database))throw Error('ROLLBACK_DATABASE_TARGET_MISMATCH');
 const fn=functionData.function;let origin;try{const url=new URL(fn?.invocation_url);if(url.protocol!=='https:'||url.username||url.password||!url.hostname.startsWith(`${branch}-${slug}.compute.`)||!url.hostname.endsWith('.neon.tech'))throw Error();origin=url.origin;}catch{throw Error('ROLLBACK_FUNCTION_TARGET_MISMATCH');}
 if(fn.slug!==slug||origin!==settings.PUBLIC_API_URL)throw Error('ROLLBACK_FUNCTION_TARGET_MISMATCH');
 return{project,branch,slug,database:PRODUCTION_TARGET.database,endpointId:endpoint.id,origin};
}
