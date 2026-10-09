import {Pool,types} from 'pg';
import {S3Client,GetObjectCommand,PutObjectCommand,DeleteObjectCommand} from '@aws-sdk/client-s3';
import {getSignedUrl} from '@aws-sdk/s3-request-presigner';
import {AppError,type DatabaseDriver,type Row} from '../../../supabase/shared/runtime.ts';

types.setTypeParser(20,value=>{const n=Number(value);if(!Number.isSafeInteger(n))throw new Error('BIGINT_OVERFLOW');return n;});
export const pool=new Pool({connectionString:process.env.DATABASE_URL,max:5,idleTimeoutMillis:10000,connectionTimeoutMillis:5000,statement_timeout:8000});
const allowed=new Set(['upload_sessions','search_runs','search_jobs','search_queries','pilot_budget','budget_reservations','provider_runs','products','product_variants','offers','product_images','search_candidates','field_evidence','price_observations','search_results','search_rank_snapshots','cleanup_tasks','source_leases']);
function identifier(name:string){if(!/^[a-z][a-z0-9_]*$/.test(name))throw new AppError('INVALID_INPUT',400);return `"${name}"`;}
function tableName(table:string){if(!allowed.has(table))throw new AppError('INVALID_INPUT',400);return `public.${identifier(table)}`;}
function normalize(value:any):any{if(value instanceof Date)return value.toISOString();if(Array.isArray(value))return value.map(normalize);if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).map(([k,v])=>[k,k.endsWith('_at')&&typeof v==='string'&&Number.isFinite(Date.parse(v))?new Date(v).toISOString():normalize(v)]));return value;}
export function sqlFilter(query:string,values:unknown[]=[]):{where:string;tail:string;values:unknown[]}{
  const params=new URLSearchParams(query),clauses:string[]=[];let tail='';const bind=(v:unknown)=>{values.push(v);return `$${values.length}`;};
  for(const [key,value] of params){
    if(key==='limit'){if(!/^\d+$/.test(value)||Number(value)>100)throw new AppError('INVALID_INPUT',400);continue;}
    if(key==='order'){tail+=' ORDER BY '+value.split(',').map(part=>{const [name,direction='asc']=part.split('.');if(!['asc','desc'].includes(direction))throw new AppError('INVALID_INPUT',400);return `${identifier(name)} ${direction}`;}).join(',');continue;}
    if(key==='or'){
      const match=value.match(/^\(created_at\.lt\.([^,]+),and\(created_at\.eq\.([^,]+),id\.lt\.([a-f0-9-]{36})\)\)$/);
      if(!match)throw new AppError('INVALID_INPUT',400);clauses.push(`(created_at<${bind(match[1])} OR (created_at=${bind(match[2])} AND id<${bind(match[3])}))`);continue;
    }
    const col=identifier(key);
    if(value==='is.null'){clauses.push(`${col} IS NULL`);continue;}if(value==='not.is.null'){clauses.push(`${col} IS NOT NULL`);continue;}
    if(value.startsWith('in.(')&&value.endsWith(')')){clauses.push(`${col} IN (${value.slice(4,-1).split(',').map(v=>bind(v)).join(',')})`);continue;}
    const match=value.match(/^(eq|lt|lte|gt|gte)\.(.*)$/s);if(!match)throw new AppError('INVALID_INPUT',400);
    clauses.push(`${col}${({eq:'=',lt:'<',lte:'<=',gt:'>',gte:'>='} as Row)[match[1]]}${bind(match[2])}`);
  }
  if(params.has('limit'))tail+=` LIMIT ${Number(params.get('limit'))}`;
  return{where:clauses.length?' WHERE '+clauses.join(' AND '):'',tail,values};
}
const s3=new S3Client({region:process.env.AWS_REGION??'us-east-1',endpoint:process.env.AWS_ENDPOINT_URL_S3,forcePathStyle:true});
const bucket=process.env.INPUT_BUCKET??'normalized-inputs';
function keyCheck(key:string){if(!/^[a-f0-9-]{36}\/[a-f0-9-]{36}\/normalized\.webp$/.test(key))throw new AppError('INVALID_INPUT',400);}
async function checkedQuery(text:string,values:unknown[]=[]){try{return await pool.query(text,values);}catch(e:any){throw new AppError(typeof e.message==='string'&&/^[A-Z_]+$/.test(e.message)?e.message:'TEMPORARILY_UNAVAILABLE',503,true);}}
export class NeonDatabase implements DatabaseDriver {
  async rows(table:string,query:string){const f=sqlFilter(query);return normalize((await checkedQuery(`SELECT * FROM ${tableName(table)}${f.where}${f.tail}`,f.values)).rows);}
  async one(table:string,query:string){return(await this.rows(table,`${query}&limit=1`))[0]??null;}
  async insert(table:string,row:Row){const keys=Object.keys(row);const result=await checkedQuery(`INSERT INTO ${tableName(table)}(${keys.map(identifier).join(',')}) VALUES(${keys.map((_,i)=>`$${i+1}`).join(',')}) RETURNING *`,Object.values(row));return normalize(result.rows[0]);}
  async patch(table:string,query:string,row:Row){const keys=Object.keys(row),f=sqlFilter(query,Object.values(row));if(!f.where||f.tail)throw new AppError('INVALID_INPUT',400);return normalize((await checkedQuery(`UPDATE ${tableName(table)} SET ${keys.map((k,i)=>`${identifier(k)}=$${i+1}`).join(',')}${f.where} RETURNING *`,f.values)).rows);}
  async rpc(name:string,args:Row={}){
    const call=`public.${identifier(name)}(${Object.keys(args).map((key,i)=>`${identifier(key)}=>$${i+1}`).join(',')})`;
    const setof=['claim_search_job','claim_cleanup'].includes(name);
    const r=await checkedQuery(setof?`SELECT * FROM ${call}`:`SELECT ${call} AS result`,Object.values(args));return normalize(setof?r.rows:r.rows[0]?.result);
  }
  async storageGet(key:string){keyCheck(key);const r=await s3.send(new GetObjectCommand({Bucket:bucket,Key:key}),{abortSignal:AbortSignal.timeout(8000)});
    if(!r.Body||!r.ContentLength||r.ContentLength>10000000)throw new AppError('UPLOAD_NOT_READY',409);
    const bytes=await r.Body.transformToByteArray();if(bytes.length>10000000)throw new AppError('IMAGE_TOO_LARGE',413);return bytes;
  }
  async storagePut(key:string,bytes:Uint8Array){keyCheck(key);if(bytes.length>10000000)throw new AppError('IMAGE_TOO_LARGE',413);await s3.send(new PutObjectCommand({Bucket:bucket,Key:key,Body:bytes,ContentType:'image/webp',CacheControl:'private, no-store'}),{abortSignal:AbortSignal.timeout(8000)});}
  async storageDelete(key:string){keyCheck(key);await s3.send(new DeleteObjectCommand({Bucket:bucket,Key:key}),{abortSignal:AbortSignal.timeout(8000)});}
  async signedInput(key:string,seconds:number){keyCheck(key);return getSignedUrl(s3,new GetObjectCommand({Bucket:bucket,Key:key}),{expiresIn:Math.max(1,Math.min(20,seconds))});}
}
