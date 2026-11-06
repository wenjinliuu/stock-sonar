import type { Env } from './env';
import { runTick } from './ingest';
import { apiRoutes } from './api';
import { verifyAccess } from './access';
import { setStateStmt } from './db';
import { computeViaBinding, runScan } from './scan';

/** 把定时任务的异常写进 runs 表，方便直接查 D1 定位问题 */
async function recordError(env: Env, kind: string, startedAt: Date, e: unknown) {
  console.error(`${kind} 失败`, e);
  const msg = e instanceof Error ? `${e.name}: ${e.message}\n${e.stack ?? ''}` : String(e);
  await env.DB.prepare("INSERT INTO runs (run_id, kind, started_at, finished_at, status, error) VALUES (?, ?, ?, ?, 'error', ?)")
    .bind(crypto.randomUUID(), kind, startedAt.toISOString(), new Date().toISOString(), msg.slice(0, 2000))
    .run()
    .catch(() => {});
}

async function scheduledWork(env: Env, at: Date) {
  // 1. 拉取日线
  try {
    const r = await runTick(env, at);
    if (r.jobs.length || r.universeSynced || r.backfillSeeded) console.log(JSON.stringify(r));
  } catch (e) {
    await recordError(env, 'ingest', at, e);
  }
  // 2. 扫描（容器未部署时跳过）
  if (!env.COMPUTE) return;
  try {
    const s = await runScan(env, computeViaBinding(env));
    if (s?.batches) {
      console.log(JSON.stringify({ scan: s }));
      await env.DB.prepare("INSERT INTO runs (run_id, kind, started_at, finished_at, status, stats_json) VALUES (?, 'scan', ?, ?, ?, ?)")
        .bind(crypto.randomUUID(), at.toISOString(), new Date().toISOString(), s.failed ? 'partial' : 'ok', JSON.stringify(s))
        .run();
    }
  } catch (e) {
    await recordError(env, 'scan', at, e);
  }
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname.startsWith('/api/')) {
      const onReject = (reason: string) =>
        ctx.waitUntil(
          setStateStmt(env.DB, 'last_access_reject', `${new Date().toISOString()} ${url.pathname} ${reason}`)
            .run()
            .catch(() => {}),
        );
      if (!(await verifyAccess(request, env, onReject))) return new Response('forbidden', { status: 403 });
      return apiRoutes(request, env, url);
    }
    return env.ASSETS.fetch(request);
  },

  async scheduled(controller: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(scheduledWork(env, new Date(controller.scheduledTime)));
  },
} satisfies ExportedHandler<Env>;
