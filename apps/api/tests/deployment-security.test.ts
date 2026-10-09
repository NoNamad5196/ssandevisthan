import {describe,it,expect,vi,afterEach} from 'vitest';
import {execFileSync} from 'node:child_process';
import {mkdirSync,mkdtempSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {publicDeploymentSettings,validateBackendSettings,validatePublicDeploymentSettings} from '../../../deploy/neon/settings.mjs';
import {PRODUCTION_TARGET,validateRollbackTarget} from '../../../deploy/neon/target.mjs';
const settings=()=>({PUBLIC_API_URL:`https://${PRODUCTION_TARGET.branch}-api.compute.c-3.ap-southeast-1.aws.neon.tech`,CORS_ORIGINS:'https://ssandevisthan.pages.dev',AUTH_JWT_SECRET_BASE64:Buffer.alloc(32,1).toString('base64'),INTERNAL_WORKER_SECRET:'w'.repeat(43),SCHEDULE_PATH_TOKEN:'s'.repeat(43),OPENAI_MODEL:'gpt-6.1-sol',PAID_EXECUTION_ENABLED:'false',NORMALIZER_VERIFIED:'true',EGRESS_VERIFIED:'true',NORMALIZER_VERSION:'sharp-webp-v3-1',INPUT_BUCKET:'search-images',VERIFIED_CLIENT_IP_HEADER:''});
describe('persistent deployment settings fail closed before sealing or deploying',()=>{
 it.each([{},null,[],{PUBLIC_API_URL:'https://example.com'}])('rejects missing and non-object settings %j',value=>expect(()=>validateBackendSettings(value)).toThrow('DEPLOYMENT_SETTINGS_INVALID'));
 it.each(Object.keys(settings()))('requires the existing %s setting',key=>{const input:Record<string,string>=settings();delete input[key];expect(()=>validateBackendSettings(input)).toThrow('DEPLOYMENT_SETTINGS_INVALID');});
 it.each([
  {PUBLIC_API_URL:'http://localhost:3000'},{PUBLIC_API_URL:'https://user:secret@example.com'},{PUBLIC_API_URL:'https://example.com/api'},{CORS_ORIGINS:''},{CORS_ORIGINS:'*'},
  {AUTH_JWT_SECRET_BASE64:'short'},{INTERNAL_WORKER_SECRET:'short'},{SCHEDULE_PATH_TOKEN:'w'.repeat(43)},{OPENAI_MODEL:'other-model'},
  {PAID_EXECUTION_ENABLED:'yes'},{PAID_EXECUTION_ENABLED:'true'},{OPENAI_API_KEY:'unrecognized'},{DATABASE_URL:'postgres://override'},
 ])('rejects invalid or unsafe settings without exposing values',changes=>{try{validateBackendSettings({...settings(),...changes});expect.fail('settings accepted');}catch(error){expect((error as Error).message).toBe('DEPLOYMENT_SETTINGS_INVALID');}});
 it('omits all secret values from the public manifest projection and rejects injected secret fields',()=>{
  const input={...settings(),OPENAI_API_KEY:'sk-'+ 'x'.repeat(32)},publicOnly=publicDeploymentSettings(input);
  expect(validateBackendSettings(input)).toEqual(input);expect(validatePublicDeploymentSettings(publicOnly)).toEqual(publicOnly);
  for(const key of ['AUTH_JWT_SECRET_BASE64','INTERNAL_WORKER_SECRET','SCHEDULE_PATH_TOKEN','OPENAI_API_KEY'] as const){expect(publicOnly).not.toHaveProperty(key);expect(JSON.stringify(publicOnly)).not.toContain(input[key]);}
  expect(()=>validatePublicDeploymentSettings({...publicOnly,OPENAI_API_KEY:input.OPENAI_API_KEY})).toThrow();
 });
 it('the actual deploy command refuses an empty JSON environment before calling a CLI or network',()=>{
  let failure:unknown;try{execFileSync(process.execPath,[resolve('deploy/neon/deploy.mjs'),'deploy'],{env:{...process.env,NEON_BACKEND_ENV_JSON:'{}',NEON_API_KEY:'synthetic-unused'},stdio:'pipe',windowsHide:true});}catch(error){failure=error;}
  expect(failure).toBeDefined();expect(String((failure as {stderr:Buffer}).stderr)).toContain('PERSISTENT_DEPLOYMENT_SETTINGS_INVALID');
 });
 it.each(['{}','null','[]'])('the actual release seal rejects configured JSON %s before reading or writing artifacts',json=>{
  let failure:unknown;try{execFileSync(process.execPath,[resolve('deploy/neon/release.mjs'),'create',resolve('.cache/nonexistent-security-fixture')],{env:{...process.env,NEON_BACKEND_ENV_JSON:json},stdio:'pipe',windowsHide:true});}catch(error){failure=error;}
  expect(failure).toBeDefined();expect(String((failure as {stderr:Buffer}).stderr)).toContain('DEPLOYMENT_SETTINGS_INVALID');
 });
 it('the actual release verifier rejects an empty saved configuration before trusting artifact files',()=>{
  mkdirSync(resolve('.cache'),{recursive:true});const directory=mkdtempSync(resolve('.cache/deployment-security-'));
  writeFileSync(resolve(directory,'release-manifest.json'),JSON.stringify({schemaVersion:1,service:'SSANDEVISTHAN',gitSha:'1'.repeat(40),runtime:'nodejs24',platform:'linux-arm64-glibc',sourceDirty:false,deploymentConfiguration:{}}));
  let failure:unknown;try{execFileSync(process.execPath,[resolve('deploy/neon/release.mjs'),'verify',directory],{env:{...process.env,EXPECTED_SHA:''},stdio:'pipe',windowsHide:true});}catch(error){failure=error;}
  expect(failure).toBeDefined();expect(String((failure as {stderr:Buffer}).stderr)).toContain('DEPLOYMENT_SETTINGS_INVALID');
 });
});
const host='ep-fixture.c-3.ap-southeast-1.aws.neon.tech',connection=new URL(`postgresql://${host}/neondb?sslmode=require&channel_binding=require`);
connection.username='neondb_owner';connection.password=['synthetic','password'].join('-');const connectionString=connection.href;
function metadata(){return{endpoints:[{id:'ep-fixture',project_id:PRODUCTION_TARGET.project,branch_id:PRODUCTION_TARGET.branch,type:'read_write',host}],function:{slug:'api',invocation_url:settings().PUBLIC_API_URL+'/'},databases:[{branch_id:PRODUCTION_TARGET.branch,name:'neondb'}]};}
function fetchFixture(data=metadata()){
 return vi.fn(async(input:RequestInfo|URL,init?:RequestInit)=>{expect(init?.method).toBe('GET');expect(init?.redirect).toBe('error');const url=String(input);const body=url.endsWith('/endpoints')?{endpoints:data.endpoints}:url.endsWith('/databases')?{databases:data.databases}:{function:data.function};return Response.json(body);});
}
describe('production rollback binds preflight database to official deployment target metadata',()=>{
 afterEach(()=>vi.restoreAllMocks());
 it.each([host,host.replace('ep-fixture.','ep-fixture-pooler.')])('accepts only the bound direct/pooler host %s using read-only metadata calls',async dbHost=>{
  const fetcher=fetchFixture(),result=await validateRollbackTarget({connectionString:connectionString.replace(host,dbHost),settings:settings(),apiKey:'synthetic-unused'},fetcher);
  expect(result).toMatchObject({project:PRODUCTION_TARGET.project,branch:PRODUCTION_TARGET.branch,database:'neondb',endpointId:'ep-fixture'});expect(fetcher).toHaveBeenCalledTimes(3);
 });
 it.each([
  connectionString.replace(host,'ep-isolated-test.c-3.ap-southeast-1.aws.neon.tech'),
  connectionString.replace(host,host+'.attacker.example'),
 ])('rejects a different database endpoint even with a healthy preflight schema',async connectionString=>{
  await expect(validateRollbackTarget({connectionString,settings:settings(),apiKey:'synthetic-unused'},fetchFixture())).rejects.toThrow('ROLLBACK_DATABASE_TARGET_MISMATCH');
 });
 it.each([
  connectionString.replace('/neondb?','/otherdb?'),connectionString.replace('neondb_owner:','otherrole:'),connectionString+'&host=127.0.0.1',connectionString+'&options=-c%20search_path%3Devil',connectionString+'&sslmode=disable',connectionString.replace('sslmode=require','sslmode=disable'),connectionString.replace(host,host+':15432'),
 ])('rejects database/query routing overrides before any metadata or database connection',async connectionString=>{
  const fetcher=fetchFixture();await expect(validateRollbackTarget({connectionString,settings:settings(),apiKey:'synthetic-unused'},fetcher)).rejects.toThrow('ROLLBACK_DATABASE_TARGET_INVALID');expect(fetcher).not.toHaveBeenCalled();
 });
 it('rejects endpoint metadata from another project/branch',async()=>{
  const data=metadata();data.endpoints[0]!.branch_id='br-other';await expect(validateRollbackTarget({connectionString,settings:settings(),apiKey:'synthetic-unused'},fetchFixture(data))).rejects.toThrow('ROLLBACK_DATABASE_TARGET_MISMATCH');
 });
 it('requires the target database and public function origin to agree with official metadata',async()=>{
  const data=metadata();data.databases=[];await expect(validateRollbackTarget({connectionString,settings:settings(),apiKey:'synthetic-unused'},fetchFixture(data))).rejects.toThrow('ROLLBACK_DATABASE_TARGET_MISMATCH');
  await expect(validateRollbackTarget({connectionString,settings:{...settings(),PUBLIC_API_URL:'https://another.example.com'},apiKey:'synthetic-unused'},fetchFixture())).rejects.toThrow('ROLLBACK_FUNCTION_TARGET_MISMATCH');
 });
 it('rejects unavailable official metadata rather than trusting an operator-provided hostname',async()=>{
  await expect(validateRollbackTarget({connectionString,settings:settings(),apiKey:'synthetic-unused'},async()=>new Response(null,{status:403}))).rejects.toThrow('ROLLBACK_TARGET_METADATA_UNAVAILABLE');
 });
});
