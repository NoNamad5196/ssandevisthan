import {randomBytes,createHash,createCipheriv,createDecipheriv} from 'node:crypto';
import {SignJWT,jwtVerify} from 'jose';
import {pool} from './database.ts';
import {AppError,jsonBody} from '../../../supabase/shared/runtime.ts';
const audience='ssandevisthan';const hash=(v:string)=>createHash('sha256').update(v).digest('hex');
function secret(){const b=Buffer.from(process.env.AUTH_JWT_SECRET_BASE64??'','base64');if(b.length<32)throw new AppError('TEMPORARILY_UNAVAILABLE',503);return b;}
function issuer(){const url=process.env.PUBLIC_API_URL;if(!url?.startsWith('https://'))throw new AppError('TEMPORARILY_UNAVAILABLE',503);return new URL(url).origin;}
function encryptionKey(){return createHash('sha256').update(secret()).update('refresh-encryption-v3').digest();}
function encrypt(value:string){const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',encryptionKey(),iv);const bytes=Buffer.concat([cipher.update(value,'utf8'),cipher.final()]);return Buffer.concat([iv,cipher.getAuthTag(),bytes]).toString('base64');}
function decrypt(value:string){const data=Buffer.from(value,'base64'),decipher=createDecipheriv('aes-256-gcm',encryptionKey(),data.subarray(0,12));decipher.setAuthTag(data.subarray(12,28));return Buffer.concat([decipher.update(data.subarray(28)),decipher.final()]).toString('utf8');}
async function access(userId:string,refreshToken:string){const exp=Math.floor(Date.now()/1000)+3600;
  const accessToken=await new SignJWT({role:'authenticated',is_anonymous:true}).setProtectedHeader({alg:'HS256',typ:'JWT'}).setIssuer(issuer()).setAudience(audience).setSubject(userId).setIssuedAt().setExpirationTime(exp).sign(secret());
  return{accessToken,refreshToken,expiresAt:new Date(exp*1000).toISOString(),userId};
}
export async function verifyOwner(req:Request):Promise<string>{
  const authorization=req.headers.get('authorization');if(!authorization?.startsWith('Bearer '))throw new AppError('UNAUTHENTICATED',401);
  try{const {payload}=await jwtVerify(authorization.slice(7),secret(),{issuer:issuer(),audience,algorithms:['HS256']});
    if(!payload.sub||payload.role!=='authenticated'||payload.is_anonymous!==true||!/^[-a-f0-9]{36}$/.test(payload.sub))throw new Error('INVALID_SUBJECT');
    const exists=await pool.query('SELECT id FROM auth.users WHERE id=$1',[payload.sub]);if(!exists.rowCount)throw new Error('INVALID_SUBJECT');return payload.sub;
  }catch(e){if(e instanceof AppError)throw e;throw new AppError('UNAUTHENTICATED',401);}
}
export async function authRoute(req:Request,refresh:boolean):Promise<Response>{
  const meta={requestId:crypto.randomUUID(),schemaVersion:3,createdAt:new Date().toISOString()};
  const headers:Record<string,string>={'Content-Type':'application/json','Cache-Control':'private, no-store',Vary:'Origin'};
  const origin=req.headers.get('origin'),allowed=(process.env.CORS_ORIGINS??'').split(',');
  if(origin&&allowed.includes(origin))headers['Access-Control-Allow-Origin']=origin;
  try{
    if(origin&&!allowed.includes(origin))throw new AppError('UNAUTHENTICATED',401);
    if(req.method!=='POST')throw new AppError('NOT_FOUND',404);
    const body=await jsonBody(req) as Record<string,unknown>;
    if(!body||body.schemaVersion!==3||Object.keys(body).some(k=>!['schemaVersion',...(refresh?['refreshToken']:[])].includes(k)))throw new AppError('INVALID_INPUT',400);
    const client=await pool.connect();let data;
    try{
      await client.query('BEGIN');
      if(!refresh){
        // An unverified forwarding header cannot mint independent abuse buckets.
        const ipHeader=process.env.VERIFIED_CLIENT_IP_HEADER;const ip=ipHeader?req.headers.get(ipHeader)??'unknown':'unknown';const ipHash=hash(secret().toString('base64')+'|'+ip);
        await client.query('SELECT pg_advisory_xact_lock(8453002)');
        const rate=await client.query('SELECT count(*)::integer n FROM auth.creation_events WHERE ip_hash=$1 AND created_at>now()-interval \'10 minutes\'',[ipHash]);
        if(rate.rows[0].n>=20)throw new AppError('RATE_LIMITED',429,true);
        const userId=crypto.randomUUID(),token=randomBytes(32).toString('base64url');
        await client.query('INSERT INTO auth.users(id) VALUES($1)',[userId]);
        await client.query('INSERT INTO auth.anonymous_sessions(owner_id,refresh_hash,refresh_ciphertext) VALUES($1,$2,$3)',[userId,hash(token),encrypt(token)]);
        await client.query('INSERT INTO auth.creation_events(ip_hash) VALUES($1)',[ipHash]);data=await access(userId,token);
      }else{
        if(typeof body.refreshToken!=='string'||!/^[-_A-Za-z0-9]{43}$/.test(body.refreshToken))throw new AppError('UNAUTHENTICATED',401);
        const tokenHash=hash(body.refreshToken);const rows=await client.query('SELECT * FROM auth.anonymous_sessions WHERE (refresh_hash=$1 OR previous_hash=$1) AND expires_at>now() FOR UPDATE',[tokenHash]);
        const session=rows.rows[0];if(!session)throw new AppError('UNAUTHENTICATED',401);
        let token:string;
        if(session.previous_hash===tokenHash){if(Date.now()-new Date(session.rotated_at).getTime()>15000)throw new AppError('UNAUTHENTICATED',401);token=decrypt(session.refresh_ciphertext);}
        else{token=randomBytes(32).toString('base64url');await client.query('UPDATE auth.anonymous_sessions SET previous_hash=refresh_hash,refresh_hash=$1,refresh_ciphertext=$2,rotated_at=now() WHERE owner_id=$3',[hash(token),encrypt(token),session.owner_id]);}
        data=await access(session.owner_id,token);
      }
      await client.query('COMMIT');
    }catch(e){await client.query('ROLLBACK');throw e;}finally{client.release();}
    return new Response(JSON.stringify({ok:true,data,meta}),{status:200,headers});
  }catch(e){const err=e instanceof AppError?e:new AppError('TEMPORARILY_UNAVAILABLE',503,true);
    return new Response(JSON.stringify({ok:false,error:{code:err.code,message:err.status===401?'세션을 확인할 수 없어요.':err.status===429?'잠시 후 다시 시도해 주세요.':'서비스 연결을 확인해 주세요.',retryable:err.retryable},meta}),{status:err.status,headers});}
}
