import {beforeAll,afterAll,describe,it,expect,vi} from 'vitest';
import {PGlite} from '@electric-sql/pglite';
import {readFile} from 'node:fs/promises';
const harness=vi.hoisted(()=>({db:null as any}));
vi.mock('../src/database.ts',()=>({pool:{
  async query(sql:string,values:unknown[]=[]){const r=await harness.db.query(sql,values);return{...r,rowCount:r.rows.length||r.affectedRows};},
  async connect(){return{query:async(sql:string,values:unknown[]=[])=>{const r=await harness.db.query(sql,values);return{...r,rowCount:r.rows.length||r.affectedRows};},release(){}};},
}}));
import {authRoute,verifyOwner} from '../src/auth.ts';
const origin='https://frontend.example',api='https://api.example';
function request(body:unknown,refresh=false,customOrigin=origin){return new Request(api+'/functions/v1/api/v3/auth/'+(refresh?'refresh':'anonymous'),{method:'POST',headers:{'Content-Type':'application/json',Origin:customOrigin},body:JSON.stringify(body)});}
async function create(){const r=await authRoute(request({schemaVersion:3}),false);expect(r.status).toBe(200);return(await r.json()).data;}
beforeAll(async()=>{
  process.env.AUTH_JWT_SECRET_BASE64=Buffer.alloc(32,17).toString('base64');process.env.PUBLIC_API_URL=api;process.env.CORS_ORIGINS=origin;
  harness.db=new PGlite();await harness.db.exec(await readFile('deploy/neon/000_bootstrap.sql','utf8'));
  await harness.db.exec('CREATE TABLE public.upload_sessions(normalizer_version text)');await harness.db.exec(await readFile('deploy/neon/004_runtime.sql','utf8'));
});
afterAll(async()=>{await harness.db.close();});
describe('Neon anonymous session protocol with real PostgreSQL transactions',()=>{
  it('issues a signed owner-scoped JWT and UTC expiry without exposing database credentials',async()=>{
    const session=await create();expect(session.refreshToken).toMatch(/^[A-Za-z0-9_-]{43}$/);expect(session.expiresAt).toMatch(/Z$/);
    expect(session.accessToken.split('.')).toHaveLength(3);expect(await verifyOwner(new Request(api,{headers:{Authorization:`Bearer ${session.accessToken}`}}))).toBe(session.userId);
    await expect(verifyOwner(new Request(api,{headers:{Authorization:`Bearer ${session.accessToken.slice(0,-6)}xxxxxx`}}))).rejects.toMatchObject({code:'UNAUTHENTICATED'});
  });
  it('rotates once, tolerates lost response replay, preserves owner, and rejects old replay after grace',async()=>{
    const original=await create();const response=await authRoute(request({schemaVersion:3,refreshToken:original.refreshToken},true),true);expect(response.status).toBe(200);const next=(await response.json()).data;
    expect(next.userId).toBe(original.userId);expect(next.refreshToken).not.toBe(original.refreshToken);
    const replay=await authRoute(request({schemaVersion:3,refreshToken:original.refreshToken},true),true);expect((await replay.json()).data.refreshToken).toBe(next.refreshToken);
    await harness.db.query("UPDATE auth.anonymous_sessions SET rotated_at=now()-interval '16 seconds' WHERE owner_id=$1",[original.userId]);
    expect((await authRoute(request({schemaVersion:3,refreshToken:original.refreshToken},true),true)).status).toBe(401);
    expect((await authRoute(request({schemaVersion:3,refreshToken:next.refreshToken},true),true)).status).toBe(200);
  });
  it('fails closed on expired sessions, invalid input and disallowed origins',async()=>{
    const session=await create();await harness.db.query("UPDATE auth.anonymous_sessions SET expires_at=now()-interval '1 second' WHERE owner_id=$1",[session.userId]);
    expect((await authRoute(request({schemaVersion:3,refreshToken:session.refreshToken},true),true)).status).toBe(401);
    expect((await authRoute(request({schemaVersion:3,ownerId:session.userId}),false)).status).toBe(400);
    const denied=await authRoute(request({schemaVersion:3},false,'https://attacker.example'),false);expect(denied.status).toBe(401);expect(denied.headers.has('Access-Control-Allow-Origin')).toBe(false);
  });
  it('bounds anonymous creation transactionally even without a trusted ingress IP header',async()=>{
    await harness.db.exec("INSERT INTO auth.creation_events(ip_hash) SELECT ip_hash FROM auth.creation_events LIMIT 1");
    for(let i=0;i<20;i++){const r=await authRoute(request({schemaVersion:3}),false);if(r.status===429){expect((await r.json()).error.code).toBe('RATE_LIMITED');return;}}
    throw new Error('RATE_LIMIT_NOT_ENFORCED');
  });
});
