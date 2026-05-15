import {
  API_PATHS,
  type AccountResponse,
  type AccountUpdateRequest,
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

export interface ApiClientOptions {
  baseUrl?: string;
  fetcher?: typeof fetch;
}

export class AuthError extends Error {
  constructor(message = 'Login expired') {
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

function authHeaders(token: string): HeadersInit {
  return {
    authorization: `Bearer ${token}`
  };
}

function apiUrl(path: string, baseUrl: string | undefined): string {
  if (!baseUrl) return path;
  return new URL(path, baseUrl).toString();
}

async function responseError(
  response: Response,
  fallback: string
): Promise<Error> {
  const body = (await response.json().catch(() => null)) as {
    error?: string;
  } | null;
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
    const response = await fetcher(apiUrl(path, options.baseUrl), init);

    if (!response.ok) {
      throw await responseError(response, `${fallback}: ${response.status}`);
    }

    return (await response.json()) as TResponse;
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

    async loginWithDevice(body: AuthLoginRequest): Promise<AuthLoginResponse> {
      return await requestJson<AuthLoginResponse>(
        API_PATHS.authLogin,
        {
          method: 'POST',
          headers: {
            'content-type': 'application/json'
          },
          body: JSON.stringify(body)
        },
        'Login failed'
      );
    },

    async signupWithDevice(
      body: AuthSignupRequest
    ): Promise<AuthLoginResponse> {
      return await requestJson<AuthLoginResponse>(
        API_PATHS.authSignup,
        {
          method: 'POST',
          headers: {
            'content-type': 'application/json'
          },
          body: JSON.stringify(body)
        },
        'Signup failed'
      );
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

    async changePassword(
      token: string,
      body: PasswordChangeRequest
    ): Promise<AccountResponse> {
      return await authedPost<PasswordChangeRequest, AccountResponse>(
        API_PATHS.accountPassword,
        token,
        body,
        'Account failed'
      );
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
export const changePassword = apiClient.changePassword;
export const setupTotp = apiClient.setupTotp;
export const enableTotp = apiClient.enableTotp;
export const disableTotp = apiClient.disableTotp;
export const revokeTrustedDevice = apiClient.revokeTrustedDevice;
export const logout = apiClient.logout;
export const deleteAccount = apiClient.deleteAccount;
