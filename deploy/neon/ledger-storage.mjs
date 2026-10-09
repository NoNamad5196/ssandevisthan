import {randomUUID} from 'node:crypto';
import {ListObjectsV2Command,PutObjectCommand,DeleteObjectCommand} from '@aws-sdk/client-s3';
import {exportLedgerSnapshot,validateLedgerSnapshot,LEDGER_MAX_BYTES,LEDGER_TTL_MS} from './ledger.mjs';

export const LEDGER_PREFIX='_recovery/ledger/v1/';
export const LEDGER_MAX_OBJECTS=2;
const keyPattern=/^_recovery\/ledger\/v1\/(\d{13})\/[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}\.json$/;
const request=(s3,command,deadline)=>s3.send(command,{abortSignal:deadline?AbortSignal.any([deadline,AbortSignal.timeout(4000)]):AbortSignal.timeout(4000)});
export function ledgerExpiry(key){const match=typeof key==='string'&&key.match(keyPattern);return match?Number(match[1]):null;}

export async function storeLedgerSnapshot(client,s3,bucket,{now=new Date(),factory=exportLedgerSnapshot}={}){
 const lock=(await client.query('SELECT pg_try_advisory_lock(8453007) locked')).rows[0]?.locked;
 if(!lock)throw Error('LEDGER_BACKUP_BUSY');
 try{
  const listed=await request(s3,new ListObjectsV2Command({Bucket:bucket,Prefix:LEDGER_PREFIX,MaxKeys:LEDGER_MAX_OBJECTS+1}));
  if(listed.IsTruncated||(listed.Contents??[]).length>=LEDGER_MAX_OBJECTS)throw Error('LEDGER_STORAGE_CAP_REACHED');
  const envelope=validateLedgerSnapshot(await factory(client,now),now),body=JSON.stringify(envelope);
  if(Buffer.byteLength(body)>LEDGER_MAX_BYTES)throw Error('LEDGER_ENVELOPE_INVALID');
  if(Date.parse(envelope.payload.expiresAt)<=Date.now()+60000)throw Error('LEDGER_EXPIRY_TOO_CLOSE');
  const key=LEDGER_PREFIX+Date.parse(envelope.payload.expiresAt)+'/'+randomUUID()+'.json';
  await request(s3,new PutObjectCommand({Bucket:bucket,Key:key,Body:body,ContentType:'application/json',CacheControl:'private, no-store',IfNoneMatch:'*'}));
  return{key,sha256:envelope.sha256,bytes:Buffer.byteLength(body),createdAt:envelope.payload.createdAt,expiresAt:envelope.payload.expiresAt};
 }finally{await client.query('SELECT pg_advisory_unlock(8453007)');}
}

// Uses object metadata only, with no database access or payload download. Runs
// solely behind the existing attested minute scheduler; no new public route.
export async function sweepLedgerBackups(s3,bucket,{now=new Date(),audit=()=>{}}={}){
 const report={scanned:0,removed:0,overdue:0,invalid:0,failed:0,deferred:0,truncated:false};
 const deadline=AbortSignal.timeout(6000);
 try{
  const listed=await request(s3,new ListObjectsV2Command({Bucket:bucket,Prefix:LEDGER_PREFIX,MaxKeys:4}),deadline);
  const objects=listed.Contents??[];report.truncated=Boolean(listed.IsTruncated);
  if(report.truncated||objects.length>LEDGER_MAX_OBJECTS)audit('backup.capacity_violation',{code:'LEDGER_STORAGE_CAP_EXCEEDED',count:objects.length});
  for(const object of objects.slice(0,4)){
   if(deadline.aborted){report.deferred=Math.min(objects.length,4)-report.scanned;break;}
   report.scanned++;const expires=ledgerExpiry(object.Key),modified=new Date(object.LastModified).getTime();
   if(expires===null||!Number.isFinite(modified)||expires-modified>LEDGER_TTL_MS+5000||expires>now.getTime()+LEDGER_TTL_MS+5000||Number(object.Size)>LEDGER_MAX_BYTES){report.invalid++;continue;}
   if(expires<=now.getTime())report.overdue++;
   if(expires>now.getTime()+60000)continue;
   try{await request(s3,new DeleteObjectCommand({Bucket:bucket,Key:object.Key}),deadline);report.removed++;}catch{report.failed++;}
  }
 }catch{report.failed++;}
 if(report.overdue)audit('backup.retention_violation',{code:'LEDGER_TTL_EXCEEDED',count:report.overdue});
 if(report.invalid)audit('backup.invalid_object',{code:'LEDGER_OBJECT_INVALID',count:report.invalid});
 if(report.failed)audit('backup.cleanup_error',{code:'LEDGER_CLEANUP_FAILED',count:report.failed});
 return report;
}
