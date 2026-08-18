import {
  API_PATHS,
  MAX_API_RESPONSE_BYTES,
  type AccountResponse,
  type AccountUpdateRequest,
  type AuthChallengeRequest,
  type AuthChallengeResponse,
  type AuthLoginRequest,
  type AuthLoginResponse,
  type AuthSignupRequest,
  type AuthValidateResponse,
  type ConfigResponse,
  type DeleteAccountRequest,
  type PasswordChangeRequest,
  type PullRequest,
  type PullResponse,
  type PushRequest,
  type PushResponse,
  type SyncStatusResponse,
  type TotpDisableRequest,
  type TotpEnableRequest,
  type TotpSetupResponse
} from '@author/api-types';
import {
  authProofFromPassword,
  base64UrlEncode,
  passwordVerifierFromPassword,
  randomAuthNonce,
  verifyAuthServerProof
} from '$lib/shared/auth-proof';

export interface ApiClientOptions {
  baseUrl?: string;
  fetcher?: typeof fetch;
}

export class AuthError extends Error {
  constructor(message = 'Sign-in expired') {
    super(message);
    this.name = 'AuthError';
  }
}

export class SyncHttpError extends Error {
  constructor(
    readonly status: number,
    message = `Sync failed: ${status}`
  ) {
    super(message);
    this.name = 'SyncHttpError';
  }
}

const COOKIE_SESSION_TOKEN = '__author_cookie_session__';

function browserSessionResponse(
  response: AuthLoginResponse
): AuthLoginResponse & { token: string } {
  return { ...response, token: response.token ?? COOKIE_SESSION_TOKEN };
}

type BrowserAccountResponse = Omit<AccountResponse, 'session'> & {
  session?: NonNullable<AccountResponse['session']> & { token: string };
};

function browserAccountResponse(
  response: AccountResponse
): BrowserAccountResponse {
  if (!response.session) return response as BrowserAccountResponse;
  return {
    ...response,
    session: {
      ...response.session,
      token: response.session.token ?? COOKIE_SESSION_TOKEN
    }
  };
}

function authHeaders(token: string): HeadersInit {
  if (token === COOKIE_SESSION_TOKEN) return {};
  return {
    authorization: `Bearer ${token}`
  };
}

async function keyringHash(
  value: string | null | undefined
): Promise<string | null> {
  if (!value) return null;
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(value)
  );
  return base64UrlEncode(new Uint8Array(digest));
}

function apiUrl(path: string, baseUrl: string | undefined): string {
  if (!baseUrl) return path;
  return new URL(path, baseUrl).toString();
}

async function boundedResponseJson<T>(response: Response): Promise<T> {
  const contentLength = Number(response.headers.get('content-length'));
  if (
    Number.isFinite(contentLength) &&
    contentLength > MAX_API_RESPONSE_BYTES
  ) {
    throw new SyncHttpError(413, 'Server response is too large');
  }
  if (!response.body) return {} as T;

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const chunks: string[] = [];
  let bytes = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    bytes += value.byteLength;
    if (bytes > MAX_API_RESPONSE_BYTES) {
      await reader.cancel().catch(() => undefined);
      throw new SyncHttpError(413, 'Server response is too large');
    }
    chunks.push(decoder.decode(value, { stream: true }));
  }
  chunks.push(decoder.decode());
  const text = chunks.join('');
  return (text ? JSON.parse(text) : {}) as T;
}

async function responseError(
  response: Response,
  fallback: string
): Promise<Error> {
  const body = (await boundedResponseJson<{ error?: string }>(response).catch(
    () => null
  )) as { error?: string } | null;
  if (response.status === 401) return new AuthError(body?.error ?? undefined);
  return new SyncHttpError(response.status, body?.error ?? fallback);
}

function createRequestHelpers(options: ApiClientOptions) {
  async function requestJson<TResponse>(
    path: string,
    init: RequestInit,
    fallback: string
  ): Promise<TResponse> {
    const fetcher = options.fetcher ?? fetch;
    const response = await fetcher(apiUrl(path, options.baseUrl), {
      credentials: options.baseUrl ? 'include' : 'same-origin',
      ...init
    });

    if (!response.ok) {
      throw await responseError(response, `${fallback}: ${response.status}`);
    }

    return await boundedResponseJson<TResponse>(response);
  }

  async function authedGet<TResponse>(
    path: string,
    token: string,
    fallback: string
  ): Promise<TResponse> {
    return await requestJson<TResponse>(
      path,
      { headers: authHeaders(token) },
      fallback
    );
  }

  async function authedPost<TRequest, TResponse>(
    path: string,
    token: string,
    body: TRequest,
    fallback = 'Sync failed'
  ): Promise<TResponse> {
    return await requestJson<TResponse>(
      path,
      {
        method: 'POST',
        headers: {
          ...authHeaders(token),
          'content-type': 'application/json'
        },
        body: JSON.stringify(body)
      },
      fallback
    );
  }

  return { requestJson, authedGet, authedPost };
}

export function createApiClient(options: ApiClientOptions = {}) {
  const { requestJson, authedGet, authedPost } = createRequestHelpers(options);

  async function requestAuthChallenge(
    body: Omit<AuthChallengeRequest, 'clientNonce'>,
    token?: string
  ): Promise<AuthChallengeResponse> {
    return await requestJson<AuthChallengeResponse>(
      API_PATHS.authChallenge,
      {
        method: 'POST',
        headers: {
          ...(token ? authHeaders(token) : {}),
          'content-type': 'application/json'
        },
        body: JSON.stringify({
          ...body,
          clientNonce: randomAuthNonce()
        } satisfies AuthChallengeRequest)
      },
      'Auth challenge failed'
    );
  }

  async function proofForPassword(
    password: string,
    challenge: AuthChallengeResponse
  ) {
    return await authProofFromPassword(password, challenge);
  }

  return {
    async loadConfig(): Promise<ConfigResponse> {
      return await requestJson<ConfigResponse>(
        API_PATHS.config,
        {},
        'Config failed'
      );
    },

    async validateSession(token: string): Promise<AuthValidateResponse> {
      return await authedGet<AuthValidateResponse>(
        API_PATHS.authValidate,
        token,
        'Session check failed'
      );
    },

    async loadSyncStatus(token: string): Promise<SyncStatusResponse> {
      return await authedGet<SyncStatusResponse>(
        API_PATHS.syncStatus,
        token,
        'Sync status failed'
      );
    },

    async requestAuthChallenge(
      body: Omit<AuthChallengeRequest, 'clientNonce'>,
      token?: string
    ): Promise<AuthChallengeResponse> {
      return await requestAuthChallenge(body, token);
    },

    async pushSyncChanges(
      token: string,
      body: PushRequest
    ): Promise<PushResponse> {
      return await authedPost<PushRequest, PushResponse>(
        API_PATHS.syncPush,
        token,
        body
      );
    },

    async pullSyncChanges(
      token: string,
      body: PullRequest
    ): Promise<PullResponse> {
      return await authedPost<PullRequest, PullResponse>(
        API_PATHS.syncPull,
        token,
        body
      );
    },

    async loginWithDevice(
      body: AuthLoginRequest
    ): Promise<AuthLoginResponse & { token: string }> {
      let requestBody: AuthLoginRequest = body;
      let expectedServerProof: string | null = null;
      if (typeof body.password === 'string' && body.password.trim()) {
        const challenge = await requestAuthChallenge({
          username: body.username,
          purpose: 'login'
        });
        if (challenge.mode === 'bootstrap') {
          requestBody = {
            username: body.username,
            bootstrapPassword: body.password,
            passwordVerifier: await passwordVerifierFromPassword(body.password),
            totpCode: body.totpCode,
            device: body.device,
            deviceTrustSecret: body.deviceTrustSecret
          };
        } else {
          const material = await proofForPassword(body.password, challenge);
          expectedServerProof = material.expectedServerProof;
          requestBody = {
            username: body.username,
            proof: material.proof,
            totpCode: body.totpCode,
            device: body.device,
            deviceTrustSecret: body.deviceTrustSecret
          };
        }
      }
      return await requestJson<AuthLoginResponse>(
        API_PATHS.authLogin,
        {
          method: 'POST',
          headers: {
            'content-type': 'application/json'
          },
          body: JSON.stringify(requestBody)
        },
        'Login failed'
      ).then((response) => {
        if (
          expectedServerProof &&
          !verifyAuthServerProof(expectedServerProof, response.serverProof)
        ) {
          throw new AuthError('Login proof failed');
        }
        return browserSessionResponse(response);
      });
    },

    async signupWithDevice(
      body: AuthSignupRequest
    ): Promise<AuthLoginResponse & { token: string }> {
      const requestBody: AuthSignupRequest = {
        ...body,
        passwordVerifier:
          body.passwordVerifier ??
          (typeof body.password === 'string'
            ? await passwordVerifierFromPassword(body.password)
            : undefined),
        password: undefined
      };
      return await requestJson<AuthLoginResponse>(
        API_PATHS.authSignup,
        {
          method: 'POST',
          headers: {
            'content-type': 'application/json'
          },
          body: JSON.stringify(requestBody)
        },
        'Signup failed'
      ).then(browserSessionResponse);
    },

    async loadAccount(token: string): Promise<AccountResponse> {
      return await authedGet<AccountResponse>(
        API_PATHS.account,
        token,
        'Account failed'
      );
    },

    async updateAccount(
      token: string,
      body: AccountUpdateRequest
    ): Promise<AccountResponse> {
      return await requestJson<AccountResponse>(
        API_PATHS.account,
        {
          method: 'PATCH',
          headers: {
            ...authHeaders(token),
            'content-type': 'application/json'
          },
          body: JSON.stringify(body)
        },
        'Account failed'
      );
    },

    async updateE2eeKeyring(
      token: string,
      e2eeKeyring: string,
      password: string,
      currentE2eeKeyring: string | null
    ): Promise<AccountResponse> {
      const challenge = await requestAuthChallenge(
        { purpose: 'keyring_update' },
        token
      );
      const material = await proofForPassword(password, challenge);
      return await requestJson<AccountResponse>(
        API_PATHS.account,
        {
          method: 'PATCH',
          headers: {
            ...authHeaders(token),
            'content-type': 'application/json'
          },
          body: JSON.stringify({
            e2eeKeyring,
            proof: material.proof,
            expectedE2eeKeyringHash: await keyringHash(currentE2eeKeyring)
          } satisfies AccountUpdateRequest)
        },
        'Account failed'
      );
    },

    async changePassword(
      token: string,
      body: PasswordChangeRequest
    ): Promise<BrowserAccountResponse> {
      const currentPassword = body.currentPassword;
      const newPassword = body.newPassword;
      if (
        typeof currentPassword !== 'string' ||
        typeof newPassword !== 'string'
      ) {
        return await authedPost<PasswordChangeRequest, AccountResponse>(
          API_PATHS.accountPassword,
          token,
          body,
          'Account failed'
        ).then(browserAccountResponse);
      }
      const challenge = await requestAuthChallenge(
        { purpose: 'password_change' },
        token
      );
      const material = await proofForPassword(currentPassword, challenge);
      return await authedPost<PasswordChangeRequest, AccountResponse>(
        API_PATHS.accountPassword,
        token,
        {
          proof: material.proof,
          newPasswordVerifier: await passwordVerifierFromPassword(newPassword),
          e2eeKeyring: body.e2eeKeyring
        },
        'Account failed'
      ).then(browserAccountResponse);
    },

    async setupTotp(token: string): Promise<TotpSetupResponse> {
      return await authedPost<Record<string, never>, TotpSetupResponse>(
        API_PATHS.accountTotpSetup,
        token,
        {},
        '2FA setup failed'
      );
    },

    async enableTotp(
      token: string,
      body: TotpEnableRequest
    ): Promise<AccountResponse> {
      if (typeof body.currentPassword === 'string') {
        const challenge = await requestAuthChallenge(
          { purpose: 'totp' },
          token
        );
        const material = await proofForPassword(
          body.currentPassword,
          challenge
        );
        return await authedPost<TotpEnableRequest, AccountResponse>(
          API_PATHS.accountTotp,
          token,
          {
            proof: material.proof,
            secret: body.secret,
            totpCode: body.totpCode
          },
          '2FA update failed'
        );
      }
      return await authedPost<TotpEnableRequest, AccountResponse>(
        API_PATHS.accountTotp,
        token,
        body,
        '2FA update failed'
      );
    },

    async disableTotp(
      token: string,
      body: TotpDisableRequest
    ): Promise<AccountResponse> {
      if (typeof body.currentPassword === 'string') {
        const challenge = await requestAuthChallenge(
          { purpose: 'totp' },
          token
        );
        const material = await proofForPassword(
          body.currentPassword,
          challenge
        );
        return await requestJson<AccountResponse>(
          API_PATHS.accountTotp,
          {
            method: 'DELETE',
            headers: {
              ...authHeaders(token),
              'content-type': 'application/json'
            },
            body: JSON.stringify({
              proof: material.proof,
              totpCode: body.totpCode
            } satisfies TotpDisableRequest)
          },
          '2FA update failed'
        );
      }
      return await requestJson<AccountResponse>(
        API_PATHS.accountTotp,
        {
          method: 'DELETE',
          headers: {
            ...authHeaders(token),
            'content-type': 'application/json'
          },
          body: JSON.stringify(body)
        },
        '2FA update failed'
      );
    },

    async revokeTrustedDevice(
      token: string,
      deviceId: string
    ): Promise<AccountResponse> {
      return await requestJson<AccountResponse>(
        `${API_PATHS.accountTrustedDevices}/${encodeURIComponent(deviceId)}`,
        {
          method: 'DELETE',
          headers: authHeaders(token)
        },
        'Trusted device update failed'
      );
    },

    async logout(token: string): Promise<void> {
      await authedPost<Record<string, never>, { ok: true }>(
        API_PATHS.authLogout,
        token,
        {}
      );
    },

    async deleteAccount(
      token: string,
      body: DeleteAccountRequest
    ): Promise<void> {
      if (typeof body.password === 'string') {
        const challenge = await requestAuthChallenge(
          { purpose: 'delete_account' },
          token
        );
        const material = await proofForPassword(body.password, challenge);
        await requestJson<{ ok: true }>(
          API_PATHS.account,
          {
            method: 'DELETE',
            headers: {
              ...authHeaders(token),
              'content-type': 'application/json'
            },
            body: JSON.stringify({
              proof: material.proof
            } satisfies DeleteAccountRequest)
          },
          'Delete account failed'
        );
        return;
      }
      await requestJson<{ ok: true }>(
        API_PATHS.account,
        {
          method: 'DELETE',
          headers: {
            ...authHeaders(token),
            'content-type': 'application/json'
          },
          body: JSON.stringify(body)
        },
        'Delete account failed'
      );
    }
  };
}

export const apiClient = createApiClient();

export const loadConfig = apiClient.loadConfig;
export const validateSession = apiClient.validateSession;
export const loadSyncStatus = apiClient.loadSyncStatus;
export const pushSyncChanges = apiClient.pushSyncChanges;
export const pullSyncChanges = apiClient.pullSyncChanges;
export const loginWithDevice = apiClient.loginWithDevice;
export const signupWithDevice = apiClient.signupWithDevice;
export const loadAccount = apiClient.loadAccount;
export const updateAccount = apiClient.updateAccount;
export const updateE2eeKeyring = apiClient.updateE2eeKeyring;
export const changePassword = apiClient.changePassword;
export const setupTotp = apiClient.setupTotp;
export const enableTotp = apiClient.enableTotp;
export const disableTotp = apiClient.disableTotp;
export const revokeTrustedDevice = apiClient.revokeTrustedDevice;
export const logout = apiClient.logout;
export const deleteAccount = apiClient.deleteAccount;
