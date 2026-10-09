import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {randomBytes} from 'node:crypto';
import {spawn} from 'node:child_process';
import {resolve} from 'node:path';
const root=resolve(import.meta.dirname,'../..'),project='lucky-sun-06718695',branch='br-polished-resonance-az03nnva',slug='api';
const secretPath=resolve(root,'.secrets/backend.env.json');
let credentials={};try{credentials=JSON.parse(await readFile(resolve(root,'.secrets/neon.json'),'utf8'));}catch{}
let settings;try{settings=JSON.parse(await readFile(secretPath,'utf8'));}catch{
  settings={PUBLIC_API_URL:'',CORS_ORIGINS:'https://ssandevisthan.pages.dev',AUTH_JWT_SECRET_BASE64:randomBytes(32).toString('base64'),INTERNAL_WORKER_SECRET:randomBytes(32).toString('base64url'),SCHEDULE_PATH_TOKEN:randomBytes(32).toString('base64url'),OPENAI_MODEL:'gpt-6.1-sol',PAID_EXECUTION_ENABLED:'false',NORMALIZER_VERIFIED:'false',EGRESS_VERIFIED:'false',NORMALIZER_VERSION:'sharp-webp-v3-1',INPUT_BUCKET:'search-images',VERIFIED_CLIENT_IP_HEADER:''};
  await mkdir(resolve(root,'.secrets'),{recursive:true});await writeFile(secretPath,JSON.stringify(settings,null,2),{flag:'wx'});
}
const apiKey=process.env.NEON_API_KEY??credentials.NEON_API_KEY;if(!apiKey)throw new Error('NEON_API_KEY_REQUIRED');
const base=`https://console.neon.tech/api/v2/projects/${project}/branches/${branch}/functions/${slug}`;
const headers={Authorization:`Bearer ${apiKey}`};
const command=process.argv[2]??'deploy';
if(command==='deploy'){
  const cli=process.env.NEON_CLI_PATH??resolve(root,'.cache/neon-npm/_npx/7f657307477966ff/node_modules/neon/dist/cli.js');
  const args=[cli,'functions','deploy',slug,'--project-id',project,'--branch',branch,'--src',resolve(root,'.cache/neon-bundle'),'--runtime','nodejs24','--no-bundle','--wait'];
  for(const [key,value] of Object.entries(settings))args.push('--env',`${key}=${value}`);
  const child=spawn(process.execPath,args,{cwd:root,env:{...process.env,NEON_API_KEY:apiKey},stdio:['ignore','pipe','pipe'],windowsHide:true});
  let output='';child.stdout.on('data',s=>output+=s);child.stderr.on('data',s=>output+=s);
  const code=await new Promise(r=>child.on('close',r));
  if(code!==0){for(const value of [apiKey,...Object.values(settings)].filter(v=>typeof v==='string'&&v.length>=20))output=output.split(value).join('[REDACTED]');console.error(output);process.exit(Number(code)||1);}
}
if(command==='configure'){
  const body=new FormData();body.set('environment',JSON.stringify(settings));body.set('runtime','nodejs24');
  const r=await fetch(base+'/deployments',{method:'POST',headers,body});if(!r.ok)throw new Error(`CONFIGURE_HTTP_${r.status}`);
}
const response=await fetch(base,{headers});if(!response.ok)throw new Error(`STATUS_HTTP_${response.status}`);const data=await response.json();
const fn=data.function??data;const url=fn.invocation_url;if(!url)throw new Error('FUNCTION_URL_MISSING');
if(settings.PUBLIC_API_URL!==new URL(url).origin){settings.PUBLIC_API_URL=new URL(url).origin;await writeFile(secretPath,JSON.stringify(settings,null,2));}
const safe={project,branch,slug,url,status:fn.state??fn.status,latestDeploymentId:fn.latest_deployment?.id??null};
await mkdir(resolve(root,'docs/deployment'),{recursive:true});await writeFile(resolve(root,'docs/deployment/backend.json'),JSON.stringify(safe,null,2)+'\n');console.info(JSON.stringify(safe));
