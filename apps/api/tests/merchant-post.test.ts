import {describe,it,expect,vi} from 'vitest';
import {SafeFetcher,assertSourcePolicy,type SafeResponse} from '../../../supabase/shared/safe-fetch.ts';
const endpoint='https://goods-detail.musinsa.com/api2/goods/12345/options/v2/prioritized-inventories';
const response=(status=200,mime='application/json',body='{"data":[]}'):SafeResponse=>({url:endpoint,status,headers:new Headers({'content-type':mime}),bytes:new TextEncoder().encode(body)});
function fixture(reply=response(),addresses=['93.184.216.34']){
 const post=vi.fn(async()=>reply),get=vi.fn(async()=>response()),resolve=vi.fn(async()=>addresses),release=vi.fn(async()=>{}),enter=vi.fn(async()=>release);
 return{post,get,resolve,release,enter,fetcher:new SafeFetcher({resolve},{get,post},{enter})};
}
describe('merchant source policy and narrow POST validation (mock transport, no LIVE request)',()=>{
 it('blocks the DNS trailing-dot alias before pipeline adapter selection',()=>{expect(()=>assertSourcePolicy(new URL('https://WWW.MUSINSA.COM./products/12345'))).toThrow('SOURCE_POLICY_BLOCKED');});
 it('blocks even a technically valid inventory request before DNS, source lease or HTTP',async()=>{
  const f=fixture();await expect(f.fetcher.postJson(endpoint,{optionValueNos:[123]},Date.now()+20000)).rejects.toThrow('SOURCE_POLICY_BLOCKED');
  expect(f.resolve).not.toHaveBeenCalled();expect(f.enter).not.toHaveBeenCalled();expect(f.post).not.toHaveBeenCalled();expect(f.get).not.toHaveBeenCalled();
 });
 it.each([endpoint.replace('goods-detail.musinsa.com','www.musinsa.com'),endpoint.replace('12345','0'),endpoint+'/other',endpoint+'?redirect=1',endpoint+'#fragment',endpoint.replace('https:','http:')])('blocks non-allowlisted endpoint %s before network access',async url=>{
  const f=fixture();await expect(f.fetcher.postJson(url,{optionValueNos:[1]},Date.now()+20000)).rejects.toThrow();expect(f.post).not.toHaveBeenCalled();expect(f.resolve).not.toHaveBeenCalled();
 });
 it.each([{optionValueNos:[]},{optionValueNos:[0]},{optionValueNos:[-1]},{optionValueNos:['123']},{optionValueNos:[1,1]},{optionValueNos:[1],url:'https://other.invalid'},{optionValueNos:Array.from({length:21},(_,i)=>i+1)}])('rejects unbounded or extra body fields',async body=>{
  const f=fixture();await expect(f.fetcher.postJson(endpoint,body as any,Date.now()+20000)).rejects.toThrow('INVALID_INPUT');expect(f.resolve).not.toHaveBeenCalled();
 });
 it.each(['https://www.musinsa.com/products/12345','https://goods-detail.musinsa.com/api2/goods/12345','https://musinsa.com/','https://m.musinsa.com/products/12345'])('blocks merchant GET at %s before DNS or HTTP',async url=>{
  const f=fixture();await expect(f.fetcher.get(url,'html',Date.now()+20000)).rejects.toThrow('SOURCE_POLICY_BLOCKED');expect(f.resolve).not.toHaveBeenCalled();expect(f.get).not.toHaveBeenCalled();
 });
 it('stops a redirect to the blocked source without issuing a second request',async()=>{
  const f=fixture();f.get.mockResolvedValue({url:'https://www.11st.co.kr/products/123',status:302,headers:new Headers({location:'https://www.musinsa.com/products/12345'}),bytes:new Uint8Array()});
  await expect(f.fetcher.get('https://www.11st.co.kr/products/123','html',Date.now()+20000)).rejects.toThrow('SOURCE_POLICY_BLOCKED');expect(f.get).toHaveBeenCalledOnce();expect(f.resolve).toHaveBeenCalledOnce();
 });
});

describe('Coupang PROVISIONAL adapter remains OFF (synthetic transport only)',()=>{
 it.each([
  ['https://coupang.com/vp/products/123','html'],
  ['https://www.coupang.com/vp/products/123?itemId=456&vendorItemId=789','html'],
  ['https://m.coupang.com/vm/products/123','html'],
  ['https://WWW.COUPANG.COM./vp/products/123','html'],
  ['https://coupangcdn.com/product.webp','image'],
  ['https://thumbnail.coupangcdn.com/product.jpg','image'],
  ['https://image.coupangcdn.com/product.png','image'],
  ['https://THUMBNAIL.COUPANGCDN.COM./product.webp','image'],
 ] as const)('blocks %s before DNS, source lease, or HTTP',async(url,kind)=>{
  const f=fixture();await expect(f.fetcher.get(url,kind,Date.now()+20000)).rejects.toMatchObject({code:'SOURCE_POLICY_BLOCKED',status:403,retryable:false});
  expect(f.resolve).not.toHaveBeenCalled();expect(f.enter).not.toHaveBeenCalled();expect(f.get).not.toHaveBeenCalled();
 });
 it.each([
  ['https://www.coupang.com/vp/products/123','html'],
  ['https://thumbnail.coupangcdn.com/product.webp','image'],
 ] as const)('blocks a redirect to %s without following it',async(location,kind)=>{
  const f=fixture();f.get.mockResolvedValue({url:'https://merchant.example.com/source',status:302,headers:new Headers({location}),bytes:new Uint8Array()});
  await expect(f.fetcher.get('https://merchant.example.com/source',kind,Date.now()+20000)).rejects.toThrow('SOURCE_POLICY_BLOCKED');
  expect(f.get).toHaveBeenCalledOnce();expect(f.resolve).toHaveBeenCalledOnce();expect(f.enter).toHaveBeenCalledOnce();
 });
 it('matches domain boundaries rather than incidental brand text',()=>{
  for(const url of ['https://merchant.example/coupang.com','https://coupang.com.example/product','https://notcoupangcdn.com/product.webp'])expect(()=>assertSourcePolicy(new URL(url))).not.toThrow();
 });
});
