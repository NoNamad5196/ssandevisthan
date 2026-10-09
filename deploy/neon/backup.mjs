import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import pg from 'pg';
import {S3Client} from '@aws-sdk/client-s3';
import {validateRollbackTarget,PRODUCTION_TARGET} from './target.mjs';
import {validateBackendSettings} from './settings.mjs';
import {storeLedgerSnapshot,LEDGER_PREFIX,LEDGER_MAX_OBJECTS} from './ledger-storage.mjs';
import {LEDGER_MAX_BYTES,LEDGER_TTL_MS} from './ledger.mjs';

export async function validateLedgerDestination(input,fetcher=fetch){
 const target=await validateRollbackTarget(input,fetcher);
 // This production-only operator tool has no caller-selected bucket/namespace.
 if(input.bucket!=='search-images'||input.s3Endpoint!==`https://${PRODUCTION_TARGET.branch}.storage.c-3.ap-southeast-1.aws.neon.tech`)throw Error('LEDGER_STORAGE_TARGET_MISMATCH');
 const response=await fetcher(`https://console.neon.tech/api/v2/projects/${target.project}/branches/${target.branch}/buckets`,{method:'GET',headers:{Authorization:'Bearer '+input.apiKey},redirect:'error',signal:AbortSignal.timeout(10000)});
 if(!response.ok)throw Error('LEDGER_BUCKET_METADATA_UNAVAILABLE');
 const data=await response.json();
 if(!(data.buckets??[]).some(bucket=>bucket.name===input.bucket&&bucket.access_level==='private'))throw Error('LEDGER_PRIVATE_BUCKET_REQUIRED');
 return target;
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 // Dry-run is purely local and does not even read/export the live cost ledger.
 if(!process.argv.includes('--apply'))console.info(JSON.stringify({mode:'DRY_RUN',source:'aggregate operational cost ledger only',destinationBucket:'search-images',prefix:LEDGER_PREFIX,maxObjects:LEDGER_MAX_OBJECTS,maxBytes:LEDGER_MAX_BYTES,ttlSeconds:LEDGER_TTL_MS/1000,productionDataReads:0,storageWrites:0,requiresVerifiedExpiryDeployment:true}));
 else{
  let client;
  try{
   const root=resolve(import.meta.dirname,'../..');
   const credentials=JSON.parse(await readFile(resolve(root,'.secrets/neon.json'),'utf8'));
   const settings=validateBackendSettings(JSON.parse(process.env.NEON_BACKEND_ENV_JSON??await readFile(resolve(root,'.secrets/backend.env.json'),'utf8')));
   const connectionString=process.env.DATABASE_URL??credentials.DATABASE_URL,apiKey=process.env.NEON_API_KEY??credentials.NEON_API_KEY;
   // Activation is deliberately explicit after the synthetic cloud expiry proof;
   // it is not installed in CI, scheduler, frontend, or normal request handling.
   if(process.env.LEDGER_BACKUP_EXPIRY_VERIFIED!=='true')throw Error('LEDGER_EXPIRY_DEPLOYMENT_UNVERIFIED');
   await validateLedgerDestination({connectionString,settings,apiKey,bucket:credentials.INPUT_BUCKET,s3Endpoint:credentials.AWS_ENDPOINT_URL_S3});
   client=new pg.Client({connectionString,connectionTimeoutMillis:10000,statement_timeout:8000,query_timeout:10000,application_name:'ssandevisthan_manual_ledger_backup'});await client.connect();
   const identity=(await client.query('SELECT current_database() db,current_user owner')).rows[0];
   if(identity.db!==PRODUCTION_TARGET.database||identity.owner!==PRODUCTION_TARGET.role)throw Error('LEDGER_DATABASE_TARGET_MISMATCH');
   const s3=new S3Client({region:credentials.AWS_REGION,endpoint:credentials.AWS_ENDPOINT_URL_S3,forcePathStyle:true,credentials:{accessKeyId:credentials.AWS_ACCESS_KEY_ID,secretAccessKey:credentials.AWS_SECRET_ACCESS_KEY}});
   try{const result=await storeLedgerSnapshot(client,s3,credentials.INPUT_BUCKET);console.info(JSON.stringify({mode:'APPLIED',sha256:result.sha256,bytes:result.bytes,createdAt:result.createdAt,expiresAt:result.expiresAt,paidProviderCalls:0,userDataExported:false}));}finally{s3.destroy();}
  }catch(error){console.error(/^(?:LEDGER_|ROLLBACK_|DEPLOYMENT_|NEON_)[A-Z_]+$/.test(error?.message)?error.message:'LEDGER_BACKUP_FAILED');process.exitCode=1;}
  finally{if(client)await client.end();}
 }
}
