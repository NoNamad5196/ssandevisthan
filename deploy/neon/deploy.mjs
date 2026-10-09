import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import {resolve} from 'node:path';
import {verifyRelease} from './release.mjs';
import {validateBackendSettings} from './settings.mjs';
import {PRODUCTION_TARGET} from './target.mjs';
const root=resolve(import.meta.dirname,'../..'),{project,branch,slug}=PRODUCTION_TARGET;
const secretPath=resolve(root,'.secrets/backend.env.json');
let credentials={};try{credentials=JSON.parse(await readFile(resolve(root,'.secrets/neon.json'),'utf8'));}catch{}
let settings;try{settings=validateBackendSettings(JSON.parse(process.env.NEON_BACKEND_ENV_JSON??await readFile(secretPath,'utf8')));}catch{throw Error('PERSISTENT_DEPLOYMENT_SETTINGS_INVALID');}
const apiKey=process.env.NEON_API_KEY??credentials.NEON_API_KEY;if(!apiKey)throw new Error('NEON_API_KEY_REQUIRED');
const base=`https://console.neon.tech/api/v2/projects/${project}/branches/${branch}/functions/${slug}`;
const headers={Authorization:`Bearer ${apiKey}`};
const command=process.argv[2]??'deploy';
if(command==='trigger'){
  const collection=`https://console.neon.tech/api/v2/projects/${project}/branches/${branch}/triggers`;
  const listed=await fetch(collection,{headers});if(!listed.ok)throw new Error(`TRIGGERS_HTTP_${listed.status}`);
  const list=await listed.json();const existing=(list.triggers??[]).find(t=>t.name==='search-sweep');
  const body={type:'schedule',function_slug:slug,name:'search-sweep',function_path:`/internal/schedule/${settings.SCHEDULE_PATH_TOKEN}`,schedule:{cron:'* * * * *'},enabled:true};
  const response=await fetch(existing?`${collection}/${existing.trigger_id}`:collection,{method:existing?'PATCH':'POST',headers:{...headers,'Content-Type':'application/json'},body:JSON.stringify(body)});
  if(!response.ok)throw new Error(`TRIGGER_WRITE_HTTP_${response.status}`);const {trigger}=await response.json();
  const safe={id:trigger.trigger_id,enabled:trigger.enabled,nextRunAt:trigger.next_run_at};await writeFile(resolve(root,'docs/deployment/schedule.json'),JSON.stringify(safe,null,2)+'\n');console.info(JSON.stringify(safe));
}
if(command==='deploy'||command==='configure'){
  const bundle=resolve(process.env.NEON_BUNDLE_DIR??resolve(root,'.cache/neon-bundle'));
  await verifyRelease(bundle,process.env.EXPECTED_SHA);
  const cli=process.env.NEON_CLI_PATH??resolve(root,'node_modules/neon/dist/cli.js');
  const args=[cli,'functions','deploy',slug,'--project-id',project,'--branch',branch,'--src',bundle,'--runtime','nodejs24','--no-bundle','--wait'];
  for(const [key,value] of Object.entries(settings))args.push('--env',`${key}=${value}`);
  const child=spawn(process.execPath,args,{cwd:root,env:{...process.env,NEON_API_KEY:apiKey},stdio:['ignore','pipe','pipe'],windowsHide:true});
  let output='';child.stdout.on('data',s=>output+=s);child.stderr.on('data',s=>output+=s);
  const code=await new Promise(r=>child.on('close',r));
  if(code!==0){for(const value of [apiKey,...Object.values(settings)].filter(v=>typeof v==='string'&&v.length>=20))output=output.split(value).join('[REDACTED]');console.error(output);process.exit(Number(code)||1);}
}
const response=await fetch(base,{headers});if(!response.ok)throw new Error(`STATUS_HTTP_${response.status}`);const data=await response.json();
const fn=data.function??data;const url=fn.invocation_url;if(!url)throw new Error('FUNCTION_URL_MISSING');
if(settings.PUBLIC_API_URL!==new URL(url).origin){settings.PUBLIC_API_URL=new URL(url).origin;await writeFile(secretPath,JSON.stringify(settings,null,2));}
const safe={project,branch,slug,url,status:fn.state??fn.status,latestDeploymentId:fn.latest_deployment?.id??null};
await mkdir(resolve(root,'docs/deployment'),{recursive:true});await writeFile(resolve(root,'docs/deployment/backend.json'),JSON.stringify(safe,null,2)+'\n');console.info(JSON.stringify(safe));
