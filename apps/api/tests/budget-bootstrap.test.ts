import {describe,it,expect,vi} from 'vitest';
import {parseUsd,rateSnapshot,applyInitialBudget} from '../../../deploy/neon/configure-budget.mjs';
import {quoteCost} from '../../../supabase/shared/providers/openai.ts';
describe('disabled budget bootstrap (no network or paid request)',()=>{
 it('uses exact decimal microdollars and the actual shared cost calculator',()=>{
  expect(parseUsd('1.000001')).toBe(1000001);expect(parseUsd('0')).toBe(0);
  expect(['analysis','discovery','comparison'].map(op=>quoteCost(rateSnapshot,op))).toEqual([5310000,10525000,5370000]);
 });
 it.each(['-1','1e2','1.0000001','NaN','20 USD'])('rejects ambiguous amount %s',value=>expect(()=>parseUsd(value)).toThrow());
 it.each([{enabled:true,history_verified_at:null,spent_microusd:'0'},{enabled:false,history_verified_at:'2026-10-09',spent_microusd:'0'},{enabled:false,history_verified_at:null,spent_microusd:'100'}])('refuses enabled, previously reconciled or decreasing-ledger mutation',async previous=>{
  const client={query:vi.fn(async(sql:string)=>({rows:sql.startsWith('SELECT')?[previous]:[]}))};
  await expect(applyInitialBudget(client,0,rateSnapshot,10525000)).rejects.toThrow();expect(client.query.mock.calls.some(([sql])=>sql.startsWith('UPDATE'))).toBe(false);expect(client.query).toHaveBeenLastCalledWith('ROLLBACK');
 });
 it('preserves existing reservations, global ceiling, quota and disabled execution in its single guarded update',async()=>{
  const previous={enabled:false,history_verified_at:null,spent_microusd:'100',search_ceiling_microusd:null};
  const client={query:vi.fn(async(sql:string,..._args:any[])=>({rows:sql.startsWith('SELECT')?[previous]:[]}))};await applyInitialBudget(client,200,rateSnapshot,10525000);
  const update=client.query.mock.calls.find(([sql])=>sql.startsWith('UPDATE'))!;expect(update[0]).not.toMatch(/budget_reservations|free_quota_verified_at|enabled\s*=|[ ,]ceiling_microusd\s*=/);expect(update[1]).toEqual([200,JSON.stringify(rateSnapshot),20000000,10525000]);expect(client.query).toHaveBeenLastCalledWith('COMMIT');
 });
});
