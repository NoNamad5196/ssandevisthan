import {createHash} from 'node:crypto';

export const LEDGER_POLICY='minimal-operational-ledger-no-user-data-v1';
export const LEDGER_MAX_BYTES=32768;
export const LEDGER_TTL_MS=3600000;
const digest=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const exact=(value,keys)=>value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).sort().join('|')===[...keys].sort().join('|');
const integer=value=>Number.isSafeInteger(value)&&value>=0;
const migrationKey=rows=>JSON.stringify([...rows].sort((a,b)=>a.name.localeCompare(b.name)).map(({name,sha256})=>({name,sha256})));

export function validateLedgerSnapshot(envelope,now=new Date()){
 const bytes=Buffer.byteLength(JSON.stringify(envelope));
 if(bytes>LEDGER_MAX_BYTES||!exact(envelope,['sha256','payload']))throw Error('LEDGER_ENVELOPE_INVALID');
 const p=envelope.payload;
 if(!exact(p,['schemaVersion','policy','createdAt','expiresAt','migrations','budget','holds'])||p.schemaVersion!==1||p.policy!==LEDGER_POLICY||!exact(p.budget,['ceilingMicrousd','spentMicrousd'])||!exact(p.holds,['parentCount','parentMicrousd','unattributedChildCount','unattributedChildMicrousd']))throw Error('LEDGER_ENVELOPE_INVALID');
 const created=Date.parse(p.createdAt),expires=Date.parse(p.expiresAt),at=now.getTime();
 if(!Number.isFinite(created)||!Number.isFinite(expires)||new Date(created).toISOString()!==p.createdAt||new Date(expires).toISOString()!==p.expiresAt||created>at+5000||expires<=created||expires-created>LEDGER_TTL_MS)throw Error('LEDGER_TIME_INVALID');
 if(expires<=at)throw Error('LEDGER_EXPIRED');
 if(!Object.values(p.budget).every(integer)||p.budget.ceilingMicrousd>20000000||!Object.values(p.holds).every(integer)||!integer(p.holds.parentMicrousd+p.holds.unattributedChildMicrousd))throw Error('LEDGER_AMOUNT_INVALID');
 if(!Array.isArray(p.migrations)||p.migrations.length<1||p.migrations.length>32||p.migrations.some(m=>!exact(m,['name','sha256'])||!/^((deploy\/neon)|(supabase\/migrations))\/[a-zA-Z0-9_]+\.sql$/.test(m.name)||!/^[a-f0-9]{64}$/.test(m.sha256))||new Set(p.migrations.map(m=>m.name)).size!==p.migrations.length)throw Error('LEDGER_MIGRATIONS_INVALID');
 if(!/^[a-f0-9]{64}$/.test(envelope.sha256)||digest(p)!==envelope.sha256)throw Error('LEDGER_CHECKSUM_MISMATCH');
 return envelope;
}

// Only aggregate cost rows are read. No search/user/provider table is queried.
export async function exportLedgerSnapshot(client,now=new Date()){
 await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
 try{
  const budget=(await client.query('SELECT ceiling_microusd,spent_microusd FROM public.pilot_budget WHERE id=true')).rows[0];
  const holds=(await client.query(`SELECT
   count(*) FILTER(WHERE operation_key='SEARCH' AND state='RESERVED') parent_count,
   coalesce(sum(reserved_microusd) FILTER(WHERE operation_key='SEARCH' AND state='RESERVED'),0) parent_amount,
   count(*) FILTER(WHERE operation_key<>'SEARCH' AND state='RESERVED' AND (search_id IS NULL OR NOT EXISTS(SELECT 1 FROM public.budget_reservations p WHERE p.search_id=b.search_id AND p.operation_key='SEARCH' AND p.state='RESERVED'))) child_count,
   coalesce(sum(reserved_microusd) FILTER(WHERE operation_key<>'SEARCH' AND state='RESERVED' AND (search_id IS NULL OR NOT EXISTS(SELECT 1 FROM public.budget_reservations p WHERE p.search_id=b.search_id AND p.operation_key='SEARCH' AND p.state='RESERVED'))),0) child_amount
   FROM public.budget_reservations b`)).rows[0];
  const migrations=(await client.query('SELECT name,sha256 FROM public.deployment_migrations ORDER BY name')).rows;
  const payload={schemaVersion:1,policy:LEDGER_POLICY,createdAt:now.toISOString(),expiresAt:new Date(now.getTime()+LEDGER_TTL_MS).toISOString(),migrations,
   budget:{ceilingMicrousd:Number(budget.ceiling_microusd),spentMicrousd:Number(budget.spent_microusd)},
   holds:{parentCount:Number(holds.parent_count),parentMicrousd:Number(holds.parent_amount),unattributedChildCount:Number(holds.child_count),unattributedChildMicrousd:Number(holds.child_amount)}};
  const envelope=validateLedgerSnapshot({sha256:digest(payload),payload},now);
  await client.query('COMMIT');return envelope;
 }catch(error){await client.query('ROLLBACK');throw error;}
}

export async function restoreLedgerSnapshot(client,envelope,now=new Date()){
 const p=validateLedgerSnapshot(envelope,now).payload;
 await client.query('BEGIN');
 try{
  await client.query('SELECT pg_advisory_xact_lock(8453006)');
  const migrations=(await client.query('SELECT name,sha256 FROM public.deployment_migrations ORDER BY name')).rows;
  if(migrationKey(p.migrations)!==migrationKey(migrations))throw Error('LEDGER_SCHEMA_MISMATCH');
  // A ledger-only restore must not overwrite either a populated application or
  // any prior ledger. Two restores cannot double reserve or reset known spend.
  const tables=(await client.query("SELECT schemaname,tablename FROM pg_tables WHERE schemaname IN ('auth','public') AND tablename NOT IN ('deployment_migrations','pilot_budget') ORDER BY schemaname,tablename")).rows;
  for(const table of tables){if(!/^[a-z_][a-z0-9_]*$/.test(table.tablename))throw Error('LEDGER_SCHEMA_MISMATCH');if(Number((await client.query(`SELECT count(*) n FROM ${table.schemaname}."${table.tablename}"`)).rows[0].n)!==0)throw Error('LEDGER_TARGET_NOT_EMPTY');}
  const before=(await client.query('SELECT spent_microusd,enabled,history_verified_at FROM public.pilot_budget WHERE id=true FOR UPDATE')).rows[0];
  if(!before||Number(before.spent_microusd)!==0||before.enabled||before.history_verified_at)throw Error('LEDGER_TARGET_NOT_EMPTY');
  await client.query('UPDATE public.pilot_budget SET ceiling_microusd=$1,spent_microusd=$2,enabled=false,history_verified_at=null,rates_verified_at=null,model_verified_at=null,free_quota_verified_at=null,rates=null,search_ceiling_microusd=null,minimum_search_reservation_microusd=null,updated_at=$3 WHERE id=true',[p.budget.ceilingMicrousd,p.budget.spentMicrousd,now.toISOString()]);
  const held=p.holds.parentMicrousd+p.holds.unattributedChildMicrousd;
  // Unknown attribution may over-hold. It can never release an uncertain cost.
  // No search exists for automatic settlement to close this orphan SEARCH hold.
  await client.query("INSERT INTO public.budget_reservations(search_id,operation_key,reserved_microusd,state) VALUES(null,'SEARCH',$1,'RESERVED')",[held]);
  await client.query('COMMIT');return{paidExecutionEnabled:false,spentMicrousd:p.budget.spentMicrousd,heldMicrousd:held,searchesRestored:0,reconciliationRequired:true};
 }catch(error){await client.query('ROLLBACK');throw error;}
}
