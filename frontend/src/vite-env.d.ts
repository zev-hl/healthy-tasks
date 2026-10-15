/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_URL?: string;
  /** Google sign-in client id. Absent in a build where Google is not wired up. */
  readonly VITE_GOOGLE_CLIENT_ID?: string;
  /** The queue dashboard the profile page links Admins to. Absent: no link. */
  readonly VITE_QUEUE_DASHBOARD_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
