import {build} from 'esbuild';
import {mkdir,writeFile,readFile,rm} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {resolve,sep} from 'node:path';

const root=resolve(import.meta.dirname,'../..'),out=resolve(root,'.cache/neon-bundle');
await mkdir(out,{recursive:true});
// Native sharp must be shipped for Neon Linux x64, never the developer host ABI.
await writeFile(resolve(out,'package.json'),JSON.stringify({private:true,type:'module',dependencies:{sharp:'0.35.5'}}));
if(!process.argv.includes('--skip-install')){
  const npm=process.platform==='win32'?'npm.cmd':'npm';
  const install=spawnSync(npm,['install','--omit=dev','--ignore-scripts','--os=linux','--cpu=x64','--libc=glibc'],{cwd:out,stdio:'inherit',shell:process.platform==='win32'});
  if(install.status!==0)process.exit(install.status??1);
}
const native=await readFile(resolve(out,'node_modules/@img/sharp-linux-x64/lib/sharp-linux-x64-0.35.5.node'));
if(native[0]!==0x7f||native.toString('ascii',1,4)!=='ELF'||native.readUInt16LE(18)!==62)throw new Error('INVALID_LINUX_X64_NATIVE_BINARY');
// Linux x64 has the verified native binary. Unused WASM fallback exceeds Neon's
// 10MiB compressed archive limit; retain all native libraries and license files.
const unused=resolve(out,'node_modules/@img/sharp-wasm32');
if(!unused.startsWith(out+sep))throw new Error('BUILD_PATH_ESCAPE');
await rm(unused,{recursive:true,force:true});
await build({entryPoints:[resolve(root,'apps/api/src/index.ts')],outfile:resolve(out,'index.mjs'),bundle:true,platform:'node',target:'node24',format:'esm',sourcemap:false,
  external:['sharp','@imagemagick/magick-wasm'],
  banner:{js:"import{createRequire as __cr}from'node:module';import{fileURLToPath as __fu}from'node:url';import{dirname as __dn}from'node:path';const require=__cr(import.meta.url);const __filename=__fu(import.meta.url);const __dirname=__dn(__filename);"}});
console.info(`Built Neon function: ${out}`);
