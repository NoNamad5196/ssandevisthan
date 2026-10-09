import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';
import pg from 'pg';
const root=resolve(import.meta.dirname,'../..');
if(!process.env.DATABASE_URL)throw new Error('DATABASE_URL_REQUIRED');
const files=['deploy/neon/000_bootstrap.sql','supabase/migrations/202610090001_v3_schema.sql','supabase/migrations/202610090002_transactions.sql','supabase/migrations/202610090003_evidence_and_recovery.sql','supabase/migrations/202610090004_upload_limits.sql','deploy/neon/004_runtime.sql'];
const client=new pg.Client({connectionString:process.env.DATABASE_URL});await client.connect();
try{
  await client.query('BEGIN');
  await client.query('SELECT pg_advisory_xact_lock(8453003)');
  await client.query('CREATE TABLE IF NOT EXISTS public.deployment_migrations(name text primary key,sha256 text not null,applied_at timestamptz not null default now())');
  for(const file of files){const sql=await readFile(resolve(root,file),'utf8'),sha=createHash('sha256').update(sql).digest('hex');
    const previous=(await client.query('SELECT sha256 FROM public.deployment_migrations WHERE name=$1',[file])).rows[0];
    if(previous){if(previous.sha256!==sha)throw new Error(`APPLIED_MIGRATION_CHANGED: ${file}`);continue;}
    await client.query(sql);await client.query('INSERT INTO public.deployment_migrations(name,sha256) VALUES($1,$2)',[file,sha]);console.info(`Applied ${file}`);
  }
  await client.query('ALTER TABLE public.deployment_migrations ENABLE ROW LEVEL SECURITY');
  await client.query('REVOKE ALL ON public.deployment_migrations FROM PUBLIC,anon,authenticated');
  await client.query('COMMIT');
}catch(e){await client.query('ROLLBACK');throw e;}finally{await client.end();}
