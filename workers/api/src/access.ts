// 第二道防线：校验 Cloudflare Access 签发的 JWT（Cf-Access-Jwt-Assertion）。
// 即使 Access 设置被误关，/api/* 也会拒绝没有有效凭证的请求（失败即关闭）。

import { createRemoteJWKSet, jwtVerify } from 'jose';

const jwksCache = new Map<string, ReturnType<typeof createRemoteJWKSet>>();

function jwks(teamDomain: string) {
  let set = jwksCache.get(teamDomain);
  if (!set) {
    set = createRemoteJWKSet(new URL(`https://${teamDomain}/cdn-cgi/access/certs`));
    jwksCache.set(teamDomain, set);
  }
  return set;
}

export interface AccessConfig {
  ACCESS_TEAM_DOMAIN?: string;
  ACCESS_AUD?: string;
  ACCESS_ALLOWED_EMAILS?: string;
}

/** 通过返回邮箱，未通过返回 null */
export async function verifyAccess(request: Request, cfg: AccessConfig): Promise<string | null> {
  const token = request.headers.get('cf-access-jwt-assertion');
  if (!token || !cfg.ACCESS_TEAM_DOMAIN || !cfg.ACCESS_AUD) return null;
  try {
    const { payload } = await jwtVerify(token, jwks(cfg.ACCESS_TEAM_DOMAIN), {
      issuer: `https://${cfg.ACCESS_TEAM_DOMAIN}`,
      audience: cfg.ACCESS_AUD,
    });
    const email = typeof payload.email === 'string' ? payload.email.toLowerCase() : '';
    const allowed = (cfg.ACCESS_ALLOWED_EMAILS ?? '')
      .split(',')
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean);
    if (allowed.length && !allowed.includes(email)) return null;
    return email || 'unknown';
  } catch {
    return null;
  }
}
