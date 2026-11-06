export interface Env {
  DB: D1Database;
  ASSETS: Fetcher;
  MASSIVE_API_KEY?: string;
  MASSIVE_BASE_URL: string;
  MAX_CALLS_PER_TICK: string;
}
