import {readFile,writeFile} from 'node:fs/promises';
import sharp from 'sharp';
import {S3Client,HeadObjectCommand} from '@aws-sdk/client-s3';
const settings=JSON.parse(await readFile('.secrets/backend.env.json','utf8')),secrets=JSON.parse(await readFile('.secrets/neon.json','utf8'));
const origin=settings.PUBLIC_API_URL,base=origin+'/functions/v1/api/v3',checks=[];
function assert(name,condition,details={}){checks.push({name,pass:!!condition,...details});if(!condition)throw new Error(name);}
async function api(path,method='GET',token,body,type='application/json',extra={}){const headers={Origin:settings.CORS_ORIGINS,...extra};if(token)headers.Authorization=`Bearer ${token}`;if(body!==undefined)headers['Content-Type']=type;const r=await fetch(base+path,{method,headers,body:body===undefined?undefined:type==='application/json'?JSON.stringify(body):body});const data=r.status===204?null:await r.json();return{r,data};}
const s3=new S3Client({region:secrets.AWS_REGION,endpoint:secrets.AWS_ENDPOINT_URL_S3,forcePathStyle:true,credentials:{accessKeyId:secrets.AWS_ACCESS_KEY_ID,secretAccessKey:secrets.AWS_SECRET_ACCESS_KEY}});
let upload,key;
try{
  const a=await api('/auth/anonymous','POST',undefined,{schemaVersion:3}),b=await api('/auth/anonymous','POST',undefined,{schemaVersion:3});assert('two real anonymous sessions',a.r.status===200&&b.r.status===200);
  const owner=a.data.data,other=b.data.data;assert('distinct owners',owner.userId!==other.userId);assert('CORS production origin',a.r.headers.get('access-control-allow-origin')===settings.CORS_ORIGINS);
  const raw=await sharp({create:{width:64,height:48,channels:3,background:{r:90,g:110,b:130}}}).png().toBuffer();
  let result=await api('/uploads','POST',owner.accessToken,{schemaVersion:3,declaredMimeType:'image/png',declaredBytes:raw.length});assert('create upload',result.r.status===201,{status:result.r.status});upload=result.data.data.uploadId;key=`${owner.userId}/${upload}/normalized.webp`;
  result=await api(`/uploads/${upload}/content`,'PUT',other.accessToken,raw,'image/png');assert('cross-owner write denied',result.r.status===404,{status:result.r.status});
  result=await api(`/uploads/${upload}/content`,'PUT',owner.accessToken,raw,'image/png');assert('normalize and private S3 write',result.r.status===200,{status:result.r.status});
  result=await api(`/uploads/${upload}/content`,'PUT',owner.accessToken,raw,'image/png');assert('same binary retry stable',result.r.status===200);
  result=await api(`/uploads/${upload}/finalize`,'POST',owner.accessToken,{schemaVersion:3});assert('finalize hash verified',result.r.status===200&&result.data.data.status==='READY');
  result=await api(`/uploads/${upload}/finalize`,'POST',other.accessToken,{schemaVersion:3});assert('cross-owner finalize denied',result.r.status===404);
  await s3.send(new HeadObjectCommand({Bucket:secrets.INPUT_BUCKET,Key:key}));assert('private normalized object exists',true);
  const unsigned=await fetch(secrets.AWS_ENDPOINT_URL_S3.replace(/\/$/,'')+'/'+secrets.INPUT_BUCKET+'/'+key);assert('unsigned storage read denied',unsigned.status!==200,{status:unsigned.status});
  result=await api('/searches','POST',owner.accessToken,{schemaVersion:3,uploadId:upload,resultLimit:10},'application/json',{'Idempotency-Key':crypto.randomUUID()});assert('unknown spend blocks paid search',result.r.status===503&&result.data.error.code==='TEMPORARILY_UNAVAILABLE',{status:result.r.status,code:result.data.error?.code});
  const refreshed=await api('/auth/refresh','POST',undefined,{schemaVersion:3,refreshToken:owner.refreshToken});assert('live refresh preserves owner',refreshed.r.status===200&&refreshed.data.data.userId===owner.userId);
  result=await api(`/uploads/${upload}`,'DELETE',owner.accessToken);assert('delete upload accepted',result.r.status===204);
  result=await api(`/uploads/${upload}/finalize`,'POST',owner.accessToken,{schemaVersion:3});assert('delete hides immediately',result.r.status===404);
  const cleanup=await fetch(origin+'/internal/sweep',{method:'POST',headers:{'x-internal-secret':settings.INTERNAL_WORKER_SECRET}});assert('live cleanup dispatcher',cleanup.status===200,{status:cleanup.status});
  let deleted=false;try{await s3.send(new HeadObjectCommand({Bucket:secrets.INPUT_BUCKET,Key:key}));}catch(e){deleted=e.$metadata?.httpStatusCode===404;}assert('private object physically removed',deleted);
}catch(e){checks.push({name:'smoke termination',pass:false,code:e.message});process.exitCode=1;}
const report={at:new Date().toISOString(),environment:'LIVE_NEON',providerCalls:0,productSearchSuccess:false,checks};await writeFile('docs/deployment/api-smoke.json',JSON.stringify(report,null,2)+'\n');console.info(JSON.stringify(report));
