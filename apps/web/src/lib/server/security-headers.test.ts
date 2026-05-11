import { describe, expect, it } from 'vitest';
import {
  applySecurityHeaders,
  contentSecurityPolicy,
  isSecureRequest
} from './security-headers';

describe('security headers', () => {
  it('builds a nonce-based CSP without allowing framing', () => {
    const csp = contentSecurityPolicy({
      nonce: 'test-nonce',
      dev: false,
      secure: true
    });

    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("script-src 'self' 'nonce-test-nonce'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain('upgrade-insecure-requests');
    expect(csp).not.toContain("'unsafe-eval'");
  });

  it('only trusts forwarded TLS headers when proxy trust is enabled', () => {
    const request = new Request('http://localhost/', {
      headers: { 'x-forwarded-proto': 'https' }
    });

    expect(isSecureRequest(request, new URL(request.url), false)).toBe(false);
    expect(isSecureRequest(request, new URL(request.url), true)).toBe(true);
  });

  it('applies browser hardening headers and limits HSTS to secure requests', () => {
    const insecure = new Response('ok');
    applySecurityHeaders(insecure, {
      nonce: 'test-nonce',
      dev: false,
      secure: false
    });

    expect(insecure.headers.get('content-security-policy')).toContain(
      "object-src 'none'"
    );
    expect(insecure.headers.get('referrer-policy')).toBe('no-referrer');
    expect(insecure.headers.get('permissions-policy')).toContain('camera=()');
    expect(insecure.headers.get('x-frame-options')).toBe('DENY');
    expect(insecure.headers.get('strict-transport-security')).toBeNull();

    const secure = new Response('ok');
    applySecurityHeaders(secure, {
      nonce: 'test-nonce',
      dev: false,
      secure: true
    });
    expect(secure.headers.get('strict-transport-security')).toContain(
      'max-age=31536000'
    );
  });
});
