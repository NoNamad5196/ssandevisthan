import {readFile,writeFile,readdir,lstat} from 'node:fs/promises';
import {resolve,relative,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {build} from 'esbuild';
import {migrationManifest} from './migrate.mjs';
import {publicDeploymentSettings,validatePublicDeploymentSettings,requiredSecretReferences} from './settings.mjs';

export const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const root=resolve(import.meta.dirname,'../..'),manifestName='release-manifest.json';
async function buildProvenance(directory,gitSha){
 const provenance=JSON.parse(await readFile(resolve(directory,'build-provenance.json'),'utf8'));
 if(provenance.schemaVersion!==1||provenance.gitSha!==gitSha||typeof provenance.sourceDirty!=='boolean'||provenance.runtime!=='nodejs24'||provenance.platform!=='linux-arm64-glibc'||!Number.isFinite(Date.parse(provenance.builtAt)))throw Error('RELEASE_BUILD_PROVENANCE_INVALID');
 if(provenance.entrySha256!==hash(await readFile(resolve(directory,'index.mjs'))))throw Error('RELEASE_BUILD_PROVENANCE_MISMATCH');
 return provenance;
}
async function filesAt(directory,base=directory){
 const files=[];for(const entry of (await readdir(directory,{withFileTypes:true})).sort((a,b)=>a.name<b.name?-1:a.name>b.name?1:0)){
  const path=resolve(directory,entry.name),stat=await lstat(path);if(stat.isSymbolicLink())throw Error('RELEASE_SYMLINK_REJECTED');
  if(entry.isDirectory())files.push(...await filesAt(path,base));else if(entry.isFile()){const name=relative(base,path).split(sep).join('/');if(name!==manifestName)files.push({name,bytes:stat.size,sha256:hash(await readFile(path))});}
 }return files;
}
export function assertDatabaseCompatibility(required,actual){
 const key=rows=>JSON.stringify([...rows].sort((a,b)=>a.name<b.name?-1:a.name>b.name?1:0).map(({name,sha256})=>({name,sha256})));
 // Unknown additional migrations may contain incompatible contract changes.
 // Explicitly reviewed compatibility or a forward fix is required in that case.
 if(key(required)!==key(actual))throw Error('ROLLBACK_SCHEMA_COMPATIBILITY_UNVERIFIED');
}
export async function verifyRelease(directory,expectedSha,{allowDirtyForDrill=false}={}){
 const base=resolve(directory),manifest=JSON.parse(await readFile(resolve(base,manifestName),'utf8'));
 if(manifest.schemaVersion!==1||manifest.service!=='SSANDEVISTHAN'||!/^[a-f0-9]{40}$/.test(manifest.gitSha)||manifest.runtime!=='nodejs24'||manifest.platform!=='linux-arm64-glibc')throw Error('RELEASE_MANIFEST_INVALID');
 if(expectedSha&&manifest.gitSha!==expectedSha)throw Error('RELEASE_COMMIT_MISMATCH');
 if(typeof manifest.sourceDirty!=='boolean'||(manifest.sourceDirty&&!allowDirtyForDrill))throw Error('RELEASE_UNCOMMITTED_SOURCE_REJECTED');
 if(!allowDirtyForDrill&&(!manifest.deploymentConfiguration||typeof manifest.deploymentConfiguration!=='object'))throw Error('RELEASE_CONFIGURATION_MISSING');
 if(manifest.deploymentConfiguration!==null)validatePublicDeploymentSettings(manifest.deploymentConfiguration);
 if(JSON.stringify(manifest.configuration?.requiredSecretReferences)!==JSON.stringify(requiredSecretReferences))throw Error('RELEASE_CONFIGURATION_INVALID');
 const actual=await filesAt(base);if(JSON.stringify(actual)!==JSON.stringify(manifest.files))throw Error('RELEASE_CONTENT_MISMATCH');
 const provenance=await buildProvenance(base,manifest.gitSha);if(provenance.sourceDirty&&!manifest.sourceDirty)throw Error('RELEASE_BUILD_PROVENANCE_INVALID');
 if(!manifest.files.some(f=>f.name==='index.mjs')||!manifest.files.some(f=>f.name.endsWith('sharp-linux-arm64-0.35.5.node')))throw Error('RELEASE_RUNTIME_MISSING');
 const native=await readFile(resolve(base,'node_modules/@img/sharp-linux-arm64/lib/sharp-linux-arm64-0.35.5.node'));
 if(native.length<20||native[0]!==0x7f||native.toString('ascii',1,4)!=='ELF'||native.readUInt16LE(18)!==183)throw Error('RELEASE_NATIVE_ARCHITECTURE_INVALID');
 return manifest;
}
export async function createRelease(directory){
 const settings=process.env.NEON_BACKEND_ENV_JSON===undefined?null:JSON.parse(process.env.NEON_BACKEND_ENV_JSON);
 const publicSettings=process.env.NEON_BACKEND_ENV_JSON===undefined?null:publicDeploymentSettings(settings);
 if(process.env.CI&&!publicSettings)throw Error('RELEASE_REQUIRES_ACTUAL_DEPLOYMENT_SETTINGS');
 const gitSha=execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim();
 const provenance=await buildProvenance(directory,gitSha);
 const sourceDirty=provenance.sourceDirty||execFileSync('git',['status','--porcelain','--untracked-files=all'],{cwd:root,encoding:'utf8'}).trim().length>0;
 if(process.env.CI&&sourceDirty)throw Error('RELEASE_UNCOMMITTED_SOURCE_REJECTED');
 const bundle=await build({stdin:{contents:"export {versions} from './supabase/shared/runtime.ts';",resolveDir:root},bundle:true,platform:'node',format:'esm',write:false,logLevel:'silent'});
 const {versions}=await import('data:text/javascript;base64,'+Buffer.from(bundle.outputFiles[0].contents).toString('base64'));
 const manifest={schemaVersion:1,service:'SSANDEVISTHAN',gitSha,sourceDirty,createdAt:new Date().toISOString(),runtime:'nodejs24',platform:'linux-arm64-glibc',components:['api','worker','sweep'],versions:{...versions,normalizerVersion:'sharp-webp-v3-1'},migrations:await migrationManifest(),deploymentConfiguration:publicSettings,
  configuration:{schemaVersion:3,model:'gpt-6.1-sol',paidExecutionDefault:false,sourcePolicy:'domestic-new-v3',secretPolicy:'Reuse current secure settings; never restore old credentials from artifacts.',requiredSecretReferences},files:await filesAt(directory)};
 await writeFile(resolve(directory,manifestName),JSON.stringify(manifest,null,2)+'\n');return manifest;
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const action=process.argv[2],directory=process.argv[3]??resolve(root,'.cache/neon-bundle');
 if(!['create','verify'].includes(action))throw Error('USAGE_RELEASE_CREATE_OR_VERIFY');
 const manifest=action==='create'?await createRelease(directory):await verifyRelease(directory,process.env.EXPECTED_SHA,{allowDirtyForDrill:process.argv[4]==='--allow-dirty-drill'});
 console.info(JSON.stringify({action,gitSha:manifest.gitSha,sourceDirty:manifest.sourceDirty,files:manifest.files.length,components:manifest.components}));
}
