import { describe, expect, it } from 'vitest';
import { verifyAccess } from '../src/access';

const cfg = { ACCESS_TEAM_DOMAIN: 'x.cloudflareaccess.com', ACCESS_AUD: 'aud', ACCESS_ALLOWED_EMAILS: 'a@b.com' };

describe('Access JWT 校验', () => {
  it('没有凭证或配置缺失时拒绝', async () => {
    expect(await verifyAccess(new Request('https://h/api/status'), cfg)).toBeNull();
    const withToken = new Request('https://h/api/status', { headers: { 'cf-access-jwt-assertion': 'x.y.z' } });
    expect(await verifyAccess(withToken, {})).toBeNull();
  });

  it('伪造的凭证被拒绝', async () => {
    const forged = new Request('https://h/api/status', {
      headers: { 'cf-access-jwt-assertion': 'eyJhbGciOiJub25lIn0.eyJlbWFpbCI6ImFAYi5jb20ifQ.' },
    });
    expect(await verifyAccess(forged, cfg)).toBeNull();
  });
});
