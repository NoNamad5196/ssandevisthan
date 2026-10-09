import {build} from 'esbuild';
import {mkdir,writeFile,readFile,readdir,rm} from 'node:fs/promises';
import {spawnSync,execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {resolve,sep} from 'node:path';

const root=resolve(import.meta.dirname,'../..'),out=resolve(root,'.cache/neon-bundle');
const sourceState=()=>({gitSha:execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim(),sourceDirty:execFileSync('git',['status','--porcelain','--untracked-files=all'],{cwd:root,encoding:'utf8'}).trim().length>0});
const before=sourceState();
if(process.env.CI&&before.sourceDirty)throw Error('BUILD_UNCOMMITTED_SOURCE_REJECTED');
await mkdir(out,{recursive:true});
// Live Singapore runtime reports linux-arm64. Ship that ABI, never the host ABI.
await writeFile(resolve(out,'package.json'),JSON.stringify({private:true,type:'module',dependencies:{sharp:'0.35.5'}}));
if(!process.argv.includes('--skip-install')){
  const npm=process.platform==='win32'?'npm.cmd':'npm';
  const install=spawnSync(npm,['install','--omit=dev','--ignore-scripts','--os=linux','--cpu=arm64','--libc=glibc'],{cwd:out,stdio:'inherit',shell:process.platform==='win32'});
  if(install.status!==0)process.exit(install.status??1);
}
const native=await readFile(resolve(out,'node_modules/@img/sharp-linux-arm64/lib/sharp-linux-arm64-0.35.5.node'));
if(native[0]!==0x7f||native.toString('ascii',1,4)!=='ELF'||native.readUInt16LE(18)!==183)throw new Error('INVALID_LINUX_ARM64_NATIVE_BINARY');
// Runtime needs no package executables. Remove npm-created symlinks before
// sealing a portable, symlink-free deployment artifact.
const executableLinks=resolve(out,'node_modules/.bin');if(!executableLinks.startsWith(out+sep))throw Error('BUILD_PATH_ESCAPE');await rm(executableLinks,{recursive:true,force:true});
// ARM64 has the verified native binary. Unused WASM fallback exceeds Neon's
// 10MiB compressed archive limit; retain all native libraries and license files.
for(const name of (await readdir(resolve(out,'node_modules/@img'))).filter(name=>name.startsWith('sharp-')&&!['sharp-linux-arm64','sharp-libvips-linux-arm64'].includes(name))){
  const unused=resolve(out,'node_modules/@img',name);if(!unused.startsWith(out+sep))throw new Error('BUILD_PATH_ESCAPE');await rm(unused,{recursive:true,force:true});
}
await build({entryPoints:[resolve(root,'apps/api/src/index.ts')],outfile:resolve(out,'index.mjs'),bundle:true,platform:'node',target:'node24',format:'esm',sourcemap:false,
  external:['sharp','@imagemagick/magick-wasm'],
  banner:{js:"import{createRequire as __cr}from'node:module';import{fileURLToPath as __fu}from'node:url';import{dirname as __dn}from'node:path';const require=__cr(import.meta.url);const __filename=__fu(import.meta.url);const __dirname=__dn(__filename);"}});
const after=sourceState();if(after.gitSha!==before.gitSha)throw Error('BUILD_SOURCE_COMMIT_CHANGED');
const sourceDirty=before.sourceDirty||after.sourceDirty;if(process.env.CI&&sourceDirty)throw Error('BUILD_UNCOMMITTED_SOURCE_REJECTED');
await writeFile(resolve(out,'build-provenance.json'),JSON.stringify({schemaVersion:1,gitSha:before.gitSha,sourceDirty,builtAt:new Date().toISOString(),runtime:'nodejs24',platform:'linux-arm64-glibc',entrySha256:createHash('sha256').update(await readFile(resolve(out,'index.mjs'))).digest('hex')},null,2)+'\n');
console.info(`Built Neon function: ${out}`);
