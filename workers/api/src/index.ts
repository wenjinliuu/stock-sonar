import type { Env } from './env';
import { runTick } from './ingest';
import { apiRoutes } from './api';

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname.startsWith('/api/')) return apiRoutes(request, env, url);
    return env.ASSETS.fetch(request);
  },

  async scheduled(controller: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(
      runTick(env, new Date(controller.scheduledTime)).then(
        (r) => {
          if (r.jobs.length || r.universeSynced || r.backfillSeeded) console.log(JSON.stringify(r));
        },
        (e) => console.error('tick 失败', e),
      ),
    );
  },
} satisfies ExportedHandler<Env>;
