// API 请求：Access 登录过期时会被重定向到登录域名，这里识别出来提示重新登录
export class NeedLogin extends Error {}

export async function getJson<T>(path: string): Promise<T> {
  const r = await fetch(path, { redirect: 'manual', credentials: 'same-origin' });
  if (r.type === 'opaqueredirect' || r.status === 401 || r.status === 403) throw new NeedLogin('登录已过期');
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
}
