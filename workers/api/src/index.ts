import type { Env } from './env';
import { runTick } from './ingest';
import { apiRoutes } from './api';
import { verifyAccess } from './access';
import { setStateStmt } from './db';

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
    ctx.waitUntil(
      runTick(env, new Date(controller.scheduledTime)).then(
        (r) => {
          if (r.jobs.length || r.universeSynced || r.backfillSeeded) console.log(JSON.stringify(r));
        },
        async (e) => {
          console.error('tick 失败', e);
          // 写进 runs 表，方便直接查 D1 定位问题
          const msg = e instanceof Error ? `${e.name}: ${e.message}\n${e.stack ?? ''}` : String(e);
          await env.DB.prepare(
            "INSERT INTO runs (run_id, kind, started_at, finished_at, status, error) VALUES (?, 'ingest', ?, ?, 'error', ?)",
          )
            .bind(crypto.randomUUID(), new Date(controller.scheduledTime).toISOString(), new Date().toISOString(), msg.slice(0, 2000))
            .run()
            .catch(() => {});
        },
      ),
    );
  },
} satisfies ExportedHandler<Env>;
