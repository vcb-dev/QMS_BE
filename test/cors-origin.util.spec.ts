import {
  corsOriginDelegate,
  isAllowedCorsOrigin,
  isVercelPreviewOf,
  normalizeOrigin,
  parseOriginList,
  primaryFrontendUrl,
} from '../src/utils/cors-origin.util';

describe('cors-origin.util', () => {
  it('bỏ slash cuối khi normalize origin', () => {
    expect(normalizeOrigin(' https://qms-fe-one.vercel.app/ ')).toBe(
      'https://qms-fe-one.vercel.app',
    );
  });

  it('tách CORS_ORIGIN nhiều origin, bỏ trùng và slash', () => {
    expect(
      parseOriginList(
        'https://qms-fe-one.vercel.app/, https://qms-fe-one.vercel.app, http://localhost:5173',
      ),
    ).toEqual([
      'https://qms-fe-one.vercel.app',
      'http://localhost:5173',
    ]);
  });

  it('cho phép preview Vercel cùng project', () => {
    expect(
      isVercelPreviewOf(
        'https://qms-fe-one.vercel.app',
        'https://qms-fe-one-git-main-team.vercel.app',
      ),
    ).toBe(true);
  });

  it('không cho origin lạ', () => {
    expect(
      isAllowedCorsOrigin('https://evil.example', [
        'https://qms-fe-one.vercel.app',
      ]),
    ).toBe(false);
  });

  it('delegate CORS không throw khi origin bị từ chối', () => {
    const delegate = corsOriginDelegate(['https://qms-fe-one.vercel.app']);
    delegate('https://evil.example', (err, allow) => {
      expect(err).toBeNull();
      expect(allow).toBe(false);
    });
  });

  it('lấy origin đầu làm URL FE chính (Lark redirect)', () => {
    expect(
      primaryFrontendUrl(
        'https://qms-fe-one.vercel.app, http://localhost:5173',
      ),
    ).toBe('https://qms-fe-one.vercel.app');
  });
});
