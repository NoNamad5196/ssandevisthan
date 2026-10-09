import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import pg from 'pg';
import {verifyRelease,assertDatabaseCompatibility} from './release.mjs';
import {validateBackendSettings} from './settings.mjs';
import {validateRollbackTarget} from './target.mjs';
export async function checkRollback(client,manifest){
 const actual=(await client.query('SELECT name,sha256 FROM public.deployment_migrations ORDER BY name')).rows;assertDatabaseCompatibility(manifest.migrations,actual);
 const b=(await client.query('SELECT enabled FROM public.pilot_budget WHERE id=true')).rows[0];if(!b||b.enabled)throw Error('ROLLBACK_REQUIRES_PAID_KILL_SWITCH');
 const active=(await client.query("SELECT count(*) n FROM public.search_runs WHERE status IN ('QUEUED','RUNNING') AND deleted_at IS NULL")).rows[0];
 if(Number(active.n)>0)throw Error('ROLLBACK_REQUIRES_JOB_DRAIN');
 return{schemaCompatible:true,paidExecutionDisabled:true,activeSearches:0,migrationsChanged:false};
}
async function main(){
 const directory=process.argv[2],apply=process.argv[3]==='--apply';if(!directory||process.argv.slice(3).some(a=>a!=='--apply'))throw Error('USAGE_ROLLBACK_RELEASE_DIRECTORY_OPTIONAL_APPLY');
 const manifest=await verifyRelease(directory);let checks=null,settings=null,target=null;
 if(apply){
  if(process.env.ROLLBACK_APPROVED_SHA!==manifest.gitSha)throw Error('EXPLICIT_REVIEWED_ROLLBACK_SHA_REQUIRED');
  if(!process.env.NEON_BACKEND_ENV_JSON||!process.env.NEON_API_KEY||!process.env.DATABASE_URL)throw Error('PERSISTENT_SERVER_SETTINGS_REQUIRED');
  try{settings=validateBackendSettings(JSON.parse(process.env.NEON_BACKEND_ENV_JSON));}catch{throw Error('PERSISTENT_DEPLOYMENT_SETTINGS_INVALID');}
  if(settings.PAID_EXECUTION_ENABLED!=='false')throw Error('ROLLBACK_REQUIRES_PAID_KILL_SWITCH');
  // Validate the DATABASE_URL against official metadata BEFORE connecting.
  // A dry-run on a test DB is never accepted as preflight for production apply.
  target=await validateRollbackTarget({connectionString:process.env.DATABASE_URL,settings,apiKey:process.env.NEON_API_KEY});
 }
 if(process.env.DATABASE_URL){const client=new pg.Client({connectionString:process.env.DATABASE_URL});try{await client.connect();await client.query('BEGIN READ ONLY');checks=await checkRollback(client,manifest);await client.query('COMMIT');}finally{await client.end().catch(()=>{});}}
 if(!apply){console.info(JSON.stringify({mode:'DRY_RUN',releaseSha:manifest.gitSha,checks,requiresDatabaseCheck:!checks,noDeploymentPerformed:true}));return;}
 if(!checks||process.env.ROLLBACK_APPROVED_SHA!==manifest.gitSha)throw Error('EXPLICIT_REVIEWED_ROLLBACK_SHA_REQUIRED');
 if(!target||!settings)throw Error('ROLLBACK_TARGET_UNVERIFIED');
 // Only code changes. No down migration, queue deletion, secret restoration,
 // budget update or schedule mutation is performed by this command.
 const result=spawnSync(process.execPath,[resolve(import.meta.dirname,'deploy.mjs'),'deploy'],{env:{...process.env,NEON_BUNDLE_DIR:resolve(directory),EXPECTED_SHA:manifest.gitSha},stdio:'inherit',windowsHide:true});if(result.status!==0)throw Error('ROLLBACK_DEPLOY_FAILED');
 const response=await fetch(settings.PUBLIC_API_URL+'/health',{signal:AbortSignal.timeout(15000)}),body=await response.json();
 if(!response.ok||body.service!=='SSANDEVISTHAN'||body.searchEnabled!==false)throw Error('ROLLBACK_HEALTH_FAILED');console.info(JSON.stringify({mode:'APPLIED_CODE_ONLY',releaseSha:manifest.gitSha,health:response.status,paidExecutionEnabled:false}));
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))main().catch(e=>{console.error(/^[A-Z_]+$/.test(e.message??'')?e.message:'ROLLBACK_FAILED');process.exitCode=1;});
