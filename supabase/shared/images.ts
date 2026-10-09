import { AppError,env,sha256 } from './runtime.ts';

export const NORMALIZER_VERSION='magick-webp-v3-1';
type Normalized={bytes:Uint8Array;width:number;height:number;sha256:string;version:string};
let imageAdapter:{normalize(raw:Uint8Array,mime:string):Promise<Normalized>;validate(bytes:Uint8Array):Promise<void>}|null=null;
export function configureImages(adapter:NonNullable<typeof imageAdapter>){imageAdapter=adapter;}
export interface ImageHeader { mime:'image/jpeg'|'image/png'|'image/webp';width:number;height:number }
function u16(b:Uint8Array,p:number){return(b[p]<<8)|b[p+1];}
function u32(b:Uint8Array,p:number,le=false){return new DataView(b.buffer,b.byteOffset,b.byteLength).getUint32(p,le);}
function ascii(b:Uint8Array,p:number,n:number){return String.fromCharCode(...b.slice(p,p+n));}
export function inspectImage(bytes:Uint8Array):ImageHeader{
  if(bytes.length>10000000)throw new AppError('IMAGE_TOO_LARGE',413);
  if(bytes.length<12)throw new AppError('INVALID_IMAGE',400);
  let mime:ImageHeader['mime'];let width=0,height=0;
  if(ascii(bytes,1,3)==='PNG'&&bytes[0]===137&&bytes[4]===13&&bytes[5]===10&&bytes[6]===26&&bytes[7]===10){
    mime='image/png';if(bytes.length<33||ascii(bytes,12,4)!=='IHDR')throw new AppError('INVALID_IMAGE',400);
    width=u32(bytes,16);height=u32(bytes,20);let end=false;
    for(let p=8;p+12<=bytes.length;){const n=u32(bytes,p),tag=ascii(bytes,p+4,4);if(n>bytes.length-p-12)throw new AppError('INVALID_IMAGE',400);
      if(tag==='acTL'||tag==='fcTL'||tag==='fdAT')throw new AppError('INVALID_IMAGE',400);p+=12+n;if(tag==='IEND'){end=p===bytes.length;break;}}
    if(!end)throw new AppError('INVALID_IMAGE',400);
  }else if(bytes[0]===255&&bytes[1]===216&&bytes[2]===255){
    mime='image/jpeg';if(bytes[bytes.length-2]!==255||bytes[bytes.length-1]!==217)throw new AppError('INVALID_IMAGE',400);
    for(let p=2;p+4<bytes.length;){if(bytes[p++]!==255)throw new AppError('INVALID_IMAGE',400);while(bytes[p]===255)p++;const marker=bytes[p++];
      if(marker===218)break;if(marker===216||marker===217||(marker>=208&&marker<=215))continue;
      const n=u16(bytes,p);if(n<2||p+n>bytes.length)throw new AppError('INVALID_IMAGE',400);
      if(marker===226&&ascii(bytes,p+2,4)==='MPF\0')throw new AppError('INVALID_IMAGE',400);
      if([192,193,194,195,197,198,199,201,202,203,205,206,207].includes(marker)){height=u16(bytes,p+3);width=u16(bytes,p+5);}p+=n;}
  }else if(ascii(bytes,0,4)==='RIFF'&&ascii(bytes,8,4)==='WEBP'){
    mime='image/webp';if(u32(bytes,4,true)+8!==bytes.length)throw new AppError('INVALID_IMAGE',400);
    let frames=0;
    for(let p=12;p+8<=bytes.length;){const tag=ascii(bytes,p,4),n=u32(bytes,p+4,true),d=p+8;
      if(n>bytes.length-d)throw new AppError('INVALID_IMAGE',400);
      if(tag==='ANIM'||tag==='ANMF')throw new AppError('INVALID_IMAGE',400);
      if(tag==='VP8X'){if(n<10||(bytes[d]&2)!==0)throw new AppError('INVALID_IMAGE',400);width=1+bytes[d+4]+(bytes[d+5]<<8)+(bytes[d+6]<<16);height=1+bytes[d+7]+(bytes[d+8]<<8)+(bytes[d+9]<<16);}
      if(tag==='VP8 '){frames++;if(n<10||ascii(bytes,d+3,3)!=='\x9d\x01\x2a')throw new AppError('INVALID_IMAGE',400);if(!width){width=(bytes[d+6]|bytes[d+7]<<8)&16383;height=(bytes[d+8]|bytes[d+9]<<8)&16383;}}
      if(tag==='VP8L'){frames++;if(n<5||bytes[d]!==47)throw new AppError('INVALID_IMAGE',400);if(!width){const bits=u32(bytes,d+1,true);width=(bits&16383)+1;height=((bits>>>14)&16383)+1;}}
      p=d+n+(n%2);
    }if(frames!==1)throw new AppError('INVALID_IMAGE',400);
  }else throw new AppError('UNSUPPORTED_MEDIA_TYPE',415);
  if(width<1||height<1)throw new AppError('INVALID_IMAGE',400);
  if(width*height>24000000)throw new AppError('IMAGE_DIMENSIONS_EXCEEDED',413);
  return{mime,width,height};
}
let initialization:Promise<void>|null=null;
async function magick(){
  const lib=await import('@imagemagick/magick-wasm');
  initialization??=(async()=>{const wasm=await Deno.readFile(env('MAGICK_WASM_PATH','./magick.wasm'));await lib.initializeImageMagick(wasm);})();
  await initialization;return lib;
}
export async function normalizeImage(raw:Uint8Array,declaredMime:string){
  if(imageAdapter)return imageAdapter.normalize(raw,declaredMime);
  const header=inspectImage(raw);if(header.mime!==declaredMime)throw new AppError('INVALID_IMAGE',400);
  if(env('NORMALIZER_VERIFIED')!=='true')throw new AppError('TEMPORARILY_UNAVAILABLE',503,true);
  const {ImageMagick,MagickFormat,MagickGeometry}=await magick();
  try{
    const result=ImageMagick.read(raw,(img)=>{
      if(img.width!==header.width||img.height!==header.height)throw new AppError('INVALID_IMAGE',400);
      img.autoOrient();img.strip();
      const scale=Math.min(1,1600/Math.max(img.width,img.height));
      if(scale<1)img.resize(new MagickGeometry(Math.max(1,Math.round(img.width*scale)),Math.max(1,Math.round(img.height*scale))));
      img.quality=85;const width=img.width,height=img.height;
      return img.write(MagickFormat.WebP,(data)=>({bytes:new Uint8Array(data),width,height}));
    });
    const output=inspectImage(result.bytes);if(output.mime!=='image/webp'||Math.max(output.width,output.height)>1600)throw new AppError('INVALID_IMAGE',400);
    return{...result,sha256:await sha256(result.bytes),version:NORMALIZER_VERSION};
  }catch(e){if(e instanceof AppError)throw e;throw new AppError('INVALID_IMAGE',400);}
}
export async function validateMerchantImage(bytes:Uint8Array):Promise<void>{
  if(imageAdapter)return imageAdapter.validate(bytes);
  const header=inspectImage(bytes);if(env('NORMALIZER_VERIFIED')!=='true')throw new AppError('TEMPORARILY_UNAVAILABLE',503,true);
  const {ImageMagick}=await magick();try{ImageMagick.read(bytes,(img)=>{if(img.width!==header.width||img.height!==header.height)throw new AppError('INVALID_IMAGE',400);});}
  catch(e){if(e instanceof AppError)throw e;throw new AppError('INVALID_IMAGE',400);}
}
