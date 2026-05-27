import { randomBytes } from 'node:crypto';
import { shouldTrustProxyHeaders } from './config';

const HSTS_VALUE = 'max-age=31536000; includeSubDomains';
const PERMISSIONS_POLICY = [
  'camera=()',
  'microphone=()',
  'geolocation=()',
  'payment=()',
  'usb=()',
  'serial=()',
  'fullscreen=(self)'
].join(', ');

export function createSecurityNonce(): string {
  return randomBytes(16).toString('base64');
}

export function isSecureRequest(
  request: Request,
  url: URL,
  trustProxyHeaders = shouldTrustProxyHeaders()
): boolean {
  if (url.protocol === 'https:') return true;
  if (!trustProxyHeaders) return false;
  return (
    request.headers
      .get('x-forwarded-proto')
      ?.split(',')[0]
      ?.trim()
      .toLowerCase() === 'https'
  );
}

export function contentSecurityPolicy({
  nonce,
  dev,
  secure
}: {
  nonce: string;
  dev: boolean;
  secure: boolean;
}): string {
  const connectSrc = ["'self'"];
  const scriptSrc = ["'self'", `'nonce-${nonce}'`];
  const styleSrcElem = ["'self'"];
  if (dev) {
    connectSrc.push(
      'http://localhost:*',
      'http://127.0.0.1:*',
      'ws://localhost:*',
      'ws://127.0.0.1:*'
    );
    scriptSrc.push("'unsafe-eval'");
    styleSrcElem.push("'unsafe-inline'");
  }

  const directives = [
    ['default-src', "'self'"],
    ['base-uri', "'self'"],
    ['object-src', "'none'"],
    ['frame-ancestors', "'none'"],
    ['frame-src', "'none'"],
    ['form-action', "'self'"],
    ['img-src', "'self'", 'data:', 'blob:'],
    ['font-src', "'self'", 'data:'],
    ['connect-src', ...connectSrc],
    ['style-src', "'self'"],
    ['style-src-elem', ...styleSrcElem],
    ['style-src-attr', "'unsafe-inline'"],
    ['script-src', ...scriptSrc],
    ['worker-src', "'self'", 'blob:'],
    ['manifest-src', "'self'"]
  ];

  if (secure) directives.push(['upgrade-insecure-requests']);

  return directives.map((directive) => directive.join(' ')).join('; ');
}

export function applySecurityHeaders(
  response: Response,
  options: { nonce: string; dev: boolean; secure: boolean }
): void {
  response.headers.set(
    'content-security-policy',
    contentSecurityPolicy(options)
  );
  response.headers.set('referrer-policy', 'no-referrer');
  response.headers.set('permissions-policy', PERMISSIONS_POLICY);
  response.headers.set('x-frame-options', 'DENY');
  response.headers.set('x-content-type-options', 'nosniff');
  if (options.secure) {
    response.headers.set('strict-transport-security', HSTS_VALUE);
  }
}
