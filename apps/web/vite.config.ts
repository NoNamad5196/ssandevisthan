import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

export default defineConfig(({ mode }) => {
 const api=loadEnv(mode,process.cwd(),'VITE_').VITE_API_BASE_URL;
 let allowedOrigin='';
 if(api){
  const url=new URL(api);
  if(url.protocol!=='https:'||url.username||url.password||url.search||url.hash||url.pathname!=='/')throw new Error('Production API configuration must be an exact HTTPS origin');
  allowedOrigin=` ${url.origin}`;
 }
 return {
  plugins:[react(),{
   name:'restrict-api-csp',
   async closeBundle(){
    const target=resolve(process.cwd(),'dist/_headers');
    const headers=await readFile(target,'utf8');
    await writeFile(target,headers.replace(/connect-src 'self'[^;]*/,`connect-src 'self'${allowedOrigin}`));
   },
  }],
  build:{sourcemap:false},server:{port:5173,strictPort:true},preview:{port:4173,strictPort:true},
 };
});
