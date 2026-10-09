import {beforeEach,describe,it,expect,vi} from 'vitest';
const state=vi.hoisted(()=>({objects:new Map<string,{body:string;at:Date}>(),send:vi.fn(),query:vi.fn()}));
vi.mock('../src/database.ts',()=>({bucket:'test-private',s3:{send:(...args:any[])=>state.send(...args)},pool:{query:(...args:any[])=>state.query(...args)}}));
import {maintenancePrelude,maintenanceCompleted,sweepOrphans} from '../src/maintenance.ts';
const owner='11111111-1111-4111-8111-111111111111',upload='22222222-2222-4222-8222-222222222222',key=`${owner}/${upload}/normalized.webp`;
beforeEach(()=>{
 state.objects.clear();state.send.mockReset();state.query.mockReset();state.query.mockResolvedValue({rows:[]});
 state.send.mockImplementation(async(command:any)=>{const input=command.input;
  switch(command.constructor.name){
   case 'ListObjectsV2Command':return{Contents:[...state.objects].filter(([k])=>k.startsWith(input.Prefix??'')).map(([Key,v])=>({Key,LastModified:v.at})),IsTruncated:false};
   case 'PutObjectCommand':state.objects.set(input.Key,{body:input.Body,at:new Date()});return{};
   case 'DeleteObjectCommand':state.objects.delete(input.Key);return{};
   case 'GetObjectCommand':{const value=state.objects.get(input.Key);if(!value)throw{$metadata:{httpStatusCode:404}};return{Body:{transformToString:async()=>value.body}};}
   default:throw new Error('UNEXPECTED_COMMAND');
  }
 });
});
describe('durable idle scheduling and private-image orphan sweep (mock S3)',()=>{
 it('keeps idle database asleep and removes expired hot markers',async()=>{
  const old=`_runtime/hot/${Date.now()-71*60000}`,future=`_runtime/retention/${Date.now()+86400000}`;state.objects.set(old,{body:'1',at:new Date()});state.objects.set(future,{body:'1',at:new Date()});
  expect(await maintenancePrelude()).toEqual({active:false,due:[]});expect(state.objects.has(old)).toBe(false);expect(state.objects.has(future)).toBe(true);expect(state.query).not.toHaveBeenCalled();
 });
 it('wakes for durable active-input marker or an expired result retention deadline',async()=>{
  const hot=`_runtime/hot/${Date.now()}`,due=`_runtime/retention/${Date.now()-1}`;state.objects.set(hot,{body:'1',at:new Date()});state.objects.set(due,{body:'1',at:new Date()});
  expect(await maintenancePrelude()).toEqual({active:true,due:[due]});
 });
 it('replaces due markers with the next real PostgreSQL retention boundary only after a sweep',async()=>{
  const due='_runtime/retention/1',at=new Date(Date.now()+7*86400000);state.objects.set(due,{body:'1',at:new Date()});state.query.mockResolvedValue({rows:[{at}]});
  await maintenanceCompleted([due]);expect(state.objects.has(due)).toBe(false);expect([...state.objects.keys()]).toContain(`_runtime/retention/${Math.ceil(at.getTime()/60000)*60000}`);
 });
 it('deletes an object older than the hard TTL without waking Postgres',async()=>{
  state.objects.set(key,{body:'synthetic',at:new Date(Date.now()-3600001)});expect(await sweepOrphans(false)).toBe(1);expect(state.objects.has(key)).toBe(false);expect(state.query).not.toHaveBeenCalled();
 });
 it('removes a post-delete upload race and preserves an active decoder lease',async()=>{
  state.objects.set(key,{body:'synthetic',at:new Date(Date.now()-40000)});state.query.mockResolvedValueOnce({rows:[]});expect(await sweepOrphans(true)).toBe(1);
  state.objects.set(key,{body:'synthetic',at:new Date(Date.now()-40000)});state.query.mockResolvedValue({rows:[{status:'PROCESSING',lease_expires_at:new Date(Date.now()+5000),expires_at:new Date(Date.now()+3600000),deleted_at:null}]});expect(await sweepOrphans(true)).toBe(0);expect(state.objects.has(key)).toBe(true);
 });
 it('continues a paginated scan using only a private non-user cursor',async()=>{
  state.send.mockImplementationOnce(async()=>{throw{$metadata:{httpStatusCode:404}};}).mockImplementationOnce(async()=>({Contents:[],NextContinuationToken:'cursor-fixture'}));
  expect(await sweepOrphans(false)).toBe(0);expect(JSON.parse(state.objects.get('_runtime/orphan-cursor.json')!.body)).toEqual({token:'cursor-fixture'});
 });
});
