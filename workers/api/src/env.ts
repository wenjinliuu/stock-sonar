import type { AccessConfig } from './access';

export interface Env extends AccessConfig {
  DB: D1Database;
  ASSETS: Fetcher;
  /** Python 计算容器（Service Binding → stock-sonar-compute） */
  COMPUTE?: Fetcher;
  MASSIVE_API_KEY?: string;
  MASSIVE_BASE_URL: string;
  MAX_CALLS_PER_TICK: string;
}
