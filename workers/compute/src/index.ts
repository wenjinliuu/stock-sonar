import { Container, getContainer } from '@cloudflare/containers';

interface Env {
  COMPUTE: DurableObjectNamespace<Compute>;
}

/** 单实例 Python 容器；空闲 5 分钟自动休眠（硬性约束：必须设 sleepAfter，避免超额计费） */
export class Compute extends Container<Env> {
  defaultPort = 8080;
  sleepAfter = '5m';
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    return getContainer(env.COMPUTE).fetch(request);
  },
} satisfies ExportedHandler<Env>;
