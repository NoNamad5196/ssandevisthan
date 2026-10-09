import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import pg from 'pg';

// Read-only operational aggregates. No images, prompts, URLs, sessions or user IDs.
const root = resolve(import.meta.dirname, '../..');
let connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  const settings = JSON.parse((await readFile(resolve(root, '.secrets/neon.json'), 'utf8')).replace(/^\uFEFF/, ''));
  connectionString = settings.DATABASE_URL;
}
if (!connectionString) throw new Error('DATABASE_URL_REQUIRED');
const client = new pg.Client({ connectionString, connectionTimeoutMillis: 10000, statement_timeout: 6000 });
try {
  await client.connect();
  await client.query('BEGIN READ ONLY');
  const rows = async sql => (await client.query(sql)).rows;
  const report = {
    observedAt: new Date().toISOString(),
    environment: 'LIVE_NEON_AGGREGATES',
    observationWindow: 'last 24 hours unless stated',
    runs: await rows(`SELECT mode,status,count(*)::int count FROM public.search_runs WHERE created_at>now()-interval '24 hours' GROUP BY mode,status ORDER BY mode,status`),
    queue: (await rows(`SELECT count(*) FILTER(WHERE state='READY')::int ready,count(*) FILTER(WHERE state='LEASED')::int leased,
      coalesce(extract(epoch FROM now()-min(created_at) FILTER(WHERE state IN ('READY','LEASED'))),0)::int oldest_seconds,
      count(*) FILTER(WHERE state='LEASED' AND lease_expires_at<now())::int expired_leases FROM public.search_jobs`))[0],
    providers: await rows(`SELECT provider,operation,status,error_code,count(*)::int count,
      percentile_cont(0.5) WITHIN GROUP(ORDER BY latency_ms) p50_ms,percentile_cont(0.95) WITHIN GROUP(ORDER BY latency_ms) p95_ms,
      sum(cost_microusd)::text settled_cost_microusd FROM public.provider_runs WHERE created_at>now()-interval '24 hours' GROUP BY provider,operation,status,error_code ORDER BY provider,operation,status`),
    gates: await rows(`SELECT gate_status,metadata_status,image_status,price_status,count(*)::int count FROM public.search_candidates WHERE created_at>now()-interval '24 hours' GROUP BY gate_status,metadata_status,image_status,price_status`),
    rejections: await rows(`SELECT reason,count(*)::int count FROM public.search_candidates c CROSS JOIN LATERAL unnest(c.reject_reasons) reason WHERE c.created_at>now()-interval '24 hours' GROUP BY reason ORDER BY count DESC`),
    retention: (await rows(`SELECT
      (SELECT count(*)::int FROM public.upload_sessions WHERE expires_at<now() AND status NOT IN ('DELETED','EXPIRED')) overdue_upload_rows,
      (SELECT count(*)::int FROM public.search_runs WHERE expires_at<now()) expired_snapshot_rows,
      (SELECT count(*)::int FROM public.cleanup_tasks WHERE state<>'DONE' AND available_at<now()) overdue_cleanup_tasks,
      (SELECT coalesce(max(extract(epoch FROM now()-available_at)),0)::int FROM public.cleanup_tasks WHERE state<>'DONE' AND available_at<now()) oldest_cleanup_delay_seconds`))[0],
    budget: (await rows(`WITH pending AS (SELECT coalesce(sum(reserved_microusd),0) amount FROM public.budget_reservations WHERE operation_key='SEARCH' AND state='RESERVED')
      SELECT enabled,ceiling_microusd::text,spent_microusd::text,pending.amount::text reserved_search_microusd,search_ceiling_microusd::text,minimum_search_reservation_microusd::text,
      CASE WHEN history_verified_at IS NOT NULL THEN greatest(0,ceiling_microusd-spent_microusd-pending.amount)::text ELSE NULL END available_microusd,
      history_verified_at,rates_verified_at,model_verified_at,free_quota_verified_at FROM public.pilot_budget CROSS JOIN pending WHERE id=true`))[0],
    schedule: (await rows('SELECT max(minute) last_active_database_sweep FROM public.schedule_ticks'))[0],
    limitations: ['Storage objects require the separate orphan sweep check.', 'Idle schedules intentionally avoid PostgreSQL; the last active sweep is not the last trigger invocation.', 'No paid-search or quality success follows from infrastructure aggregates.'],
  };
  await client.query('COMMIT');
  const output = JSON.stringify(report, null, 2) + '\n';
  if (process.argv[2]) await writeFile(resolve(process.argv[2]), output);
  process.stdout.write(output);
} catch (error) {
  await client.query('ROLLBACK').catch(() => {});
  // Connection/parser errors may contain infrastructure details. Keep only a safe code.
  console.error(`OPERATIONS_READ_FAILED: ${/^[A-Z0-9_]+$/.test(error.code ?? '') ? error.code : 'UNAVAILABLE'}`);
  process.exitCode = 1;
} finally { await client.end().catch(() => {}); }
