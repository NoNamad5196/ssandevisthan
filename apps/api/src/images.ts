import sharp from 'sharp';
import {AppError,sha256} from '../../../supabase/shared/runtime.ts';
import {inspectImage} from '../../../supabase/shared/images.ts';
sharp.cache(false);sharp.concurrency(1);
export const NORMALIZER_VERSION='sharp-webp-v3-1';
const options={limitInputPixels:24000000,failOn:'warning' as const,animated:true,sequentialRead:true};
export async function validateImage(bytes:Uint8Array){
  const header=inspectImage(bytes);const metadata=await sharp(bytes,options).metadata();
  if((metadata.pages??1)!==1||metadata.width!==header.width||metadata.height!==header.height||metadata.format!==({'image/jpeg':'jpeg','image/png':'png','image/webp':'webp'} as const)[header.mime])throw new AppError('INVALID_IMAGE',400);
  // A full decode catches truncated/corrupt payloads that a metadata-only check misses.
  await sharp(bytes,options).timeout({seconds:8}).resize({width:1,height:1,fit:'inside'}).raw().toBuffer();
}
export async function normalizeImage(raw:Uint8Array,mime:string){
  const header=inspectImage(raw);if(header.mime!==mime)throw new AppError('INVALID_IMAGE',400);
  if(process.env.NORMALIZER_VERIFIED!=='true')throw new AppError('TEMPORARILY_UNAVAILABLE',503,true);
  return normalizeVerifiedBytes(raw);
}
async function normalizeVerifiedBytes(raw:Uint8Array){
  try{const metadata=await sharp(raw,options).metadata();if((metadata.pages??1)!==1)throw new AppError('INVALID_IMAGE',400);
    const {data,info}=await sharp(raw,options).timeout({seconds:8}).rotate().resize({width:1600,height:1600,fit:'inside',withoutEnlargement:true}).webp({quality:85}).toBuffer({resolveWithObject:true});
    // sharp strips EXIF/ICC by default; alpha remains intact.
    const bytes=new Uint8Array(data);return{bytes,width:info.width,height:info.height,sha256:await sha256(bytes),version:NORMALIZER_VERSION};
  }catch(e){if(e instanceof AppError)throw e;throw new AppError('INVALID_IMAGE',400);}
}
export async function benchmarkNormalizer(){
  // Synthetic noise only, generated in RAM; no user data or durable fixture file.
  const pixels=Buffer.allocUnsafe(6000*4000*3);let seed=94721;
  for(let i=0;i<pixels.length;i++){seed^=seed<<13;seed^=seed>>>17;seed^=seed<<5;pixels[i]=seed&255;}
  const input=await sharp(pixels,{raw:{width:6000,height:4000,channels:3}}).jpeg({quality:25}).toBuffer();inspectImage(input);
  let peakRss=process.memoryUsage().rss;const sampler=setInterval(()=>{peakRss=Math.max(peakRss,process.memoryUsage().rss);},5);
  const start=performance.now(),cpu=process.cpuUsage();let result;
  try{result=await normalizeVerifiedBytes(input);}finally{clearInterval(sampler);peakRss=Math.max(peakRss,process.memoryUsage().rss);}
  const elapsed=performance.now()-start,used=process.cpuUsage(cpu);const meta=await sharp(result.bytes).metadata();
  const pass=Math.max(result.width,result.height)<=1600&&meta.format==='webp'&&!meta.exif&&!meta.icc&&(used.user+used.system)<8000000&&peakRss<768*1024*1024;
  return{pass,inputBytes:input.length,inputPixels:24000000,width:result.width,height:result.height,outputBytes:result.bytes.length,wallMs:Math.round(elapsed),cpuMs:Math.round((used.user+used.system)/1000),peakRssBytes:peakRss,metadataRemoved:!meta.exif&&!meta.icc,version:NORMALIZER_VERSION};
}
