declare global {
  namespace App {
    // interface Error {}
    // interface Locals {}
    // interface PageData {}
    // interface PageState {}
    interface Platform {
      env?: {
        NOTES_DB_PROVIDER?: string;
        TURSO_DATABASE_URL?: string;
        TURSO_AUTH_TOKEN?: string;
        NOTES_LOGIN_USERNAME?: string;
        NOTES_LOGIN_PASSWORD?: string;
        NOTES_AUTH_SESSION_DAYS?: string;
        NOTES_SIGNUP_ALLOWED_EMAILS?: string;
        NOTES_REMOTE_SYNC_ENABLED?: string;
        NOTES_CLEANUP_ENABLED?: string;
        NOTES_CLEANUP_RUN_ON_START?: string;
        NOTES_CLEANUP_INTERVAL_MINUTES?: string;
        NOTES_TRUST_PROXY_HEADERS?: string;
        NOTES_LEGACY_AUTH_TOKEN_ENABLED?: string;
        NOTES_AUTH_TOKEN?: string;
        NOTES_RECORD_LIMITS_ENABLED?: string;
        NOTES_RECORD_LIMIT_STORAGE_BYTES?: string;
        NOTES_RECORD_LIMIT_SAFETY_RATIO?: string;
        NOTES_RECORD_LIMIT_NOTE_BYTES?: string;
        NOTES_RECORD_LIMIT_NOTEBOOK_BYTES?: string;
        AUTHOR_API_URL?: string;
      };
    }
  }
}

export {};
