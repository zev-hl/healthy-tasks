import { env } from '../config/env.js';

/**
 * Our Connect (Nov 2026 plan, Stage 4), through its bot API with a read/write
 * key named "HL Central". Messages to a person (K3), calls booked or rung now
 * (K2), and group chats (K5). Everything is server-to-server; the key never
 * reaches a browser. Off until CONNECT_URL and CONNECT_API_KEY are set.
 * People are named by their email, which Connect matches to its accounts.
 */

type Fetch = typeof fetch;
let doFetch: Fetch = (...args) => fetch(...args);
/** Tests stand in for Connect. */
export function __setConnectFetch(f: Fetch | null): void {
  doFetch = f ?? ((...args) => fetch(...args));
}

export function connectAvailable(): boolean {
  return !!(env.connect.url && env.connect.apiKey);
}

/** Connect said no (its own words, and its status), or couldn't be reached (status 0). */
export class ConnectError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  if (!connectAvailable()) throw new ConnectError('Connect isn’t linked to HL Central yet', 0);
  let res: Response;
  try {
    res = await doFetch(`${env.connect.url}${path}`, {
      method,
      headers: {
        authorization: `Bearer ${env.connect.apiKey}`,
        ...(body !== undefined && { 'content-type': 'application/json' }),
      },
      ...(body !== undefined && { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    throw new ConnectError('Connect couldn’t be reached', 0);
  }
  const text = await res.text();
  let json: unknown = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    /* not JSON */
  }
  if (!res.ok) {
    const msg =
      (json as { error?: string; message?: string } | null)?.error ??
      (json as { message?: string } | null)?.message ??
      `Connect answered ${res.status}`;
    throw new ConnectError(String(msg), res.status);
  }
  return json as T;
}

/** The address of a chat in Connect, for a link. */
export function connectChatUrl(conversationId: string): string {
  return `${env.connect.url}/dms?c=${encodeURIComponent(conversationId)}`;
}

// --- Messages (K3) -------------------------------------------------------------

export async function sendConnectMessage(o: {
  to?: string;
  conversationId?: string;
  text: string;
  /** Our id for it: a retry never posts twice. */
  idempotencyKey?: string;
}): Promise<{ conversationId: string; messageId: string }> {
  return call('POST', '/api/v1/bots/messages', {
    ...(o.conversationId ? { conversationId: o.conversationId } : { to: o.to }),
    text: o.text.slice(0, 4000),
    ...(o.idempotencyKey && { idempotencyKey: o.idempotencyKey.slice(0, 100) }),
  });
}

// --- Calls (K2) ------------------------------------------------------------------

export interface ConnectCall {
  id: string;
  status: string;
  joinUrl: string;
  conversationId?: string;
  skipped?: string[];
}

export async function bookConnectCall(o: {
  title: string;
  startAt: Date;
  endAt: Date | null;
  host: string;
  participants: string[];
  notes?: string | null;
  link?: string | null;
  externalRef: string;
}): Promise<ConnectCall> {
  const r = await call<{ call: ConnectCall }>('POST', '/api/v1/bots/convenes', {
    title: o.title.slice(0, 120),
    startAt: o.startAt.toISOString(),
    ...(o.endAt && { endAt: o.endAt.toISOString() }),
    host: o.host,
    participants: o.participants,
    ...(o.notes && { notes: o.notes.slice(0, 2000) }),
    ...(o.link && { link: o.link }),
    externalRef: o.externalRef,
  });
  return r.call;
}

export async function moveConnectCall(
  id: string,
  o: { title?: string; startAt?: Date; endAt?: Date | null; participants?: string[] },
): Promise<ConnectCall> {
  const r = await call<{ call: ConnectCall }>(
    'PATCH',
    `/api/v1/bots/convenes/${encodeURIComponent(id)}`,
    {
      ...(o.title !== undefined && { title: o.title.slice(0, 120) }),
      ...(o.startAt && { startAt: o.startAt.toISOString() }),
      ...(o.endAt !== undefined && { endAt: o.endAt ? o.endAt.toISOString() : null }),
      ...(o.participants && { participants: o.participants }),
    },
  );
  return r.call;
}

export async function cancelConnectCall(id: string): Promise<void> {
  await call('DELETE', `/api/v1/bots/convenes/${encodeURIComponent(id)}`);
}

export async function ringConnectCall(o: {
  host: string;
  participants: string[];
  title: string;
  externalRef: string;
}): Promise<ConnectCall> {
  const r = await call<{ call: ConnectCall }>('POST', '/api/v1/bots/calls', {
    host: o.host,
    participants: o.participants,
    title: o.title.slice(0, 120),
    externalRef: o.externalRef,
  });
  return r.call;
}

/** The calls the key booked, coming ones first (K4: shown on the calendar). */
export async function listConnectCalls(): Promise<
  (ConnectCall & {
    title: string;
    startAt: string;
    endAt: string | null;
    host: string;
    participants: string[];
  })[]
> {
  const r = await call<{ calls: never[] }>('GET', '/api/v1/bots/convenes?state=upcoming&limit=200');
  return r.calls ?? [];
}

// --- Group chats (K5) -------------------------------------------------------------

export async function makeConnectGroup(o: {
  name: string;
  topic?: string;
  members: string[];
}): Promise<{ id: string; skipped: string[] }> {
  const r = await call<{ conversation: { id: string }; skipped?: string[] }>(
    'POST',
    '/api/v1/bots/groups',
    {
      name: o.name.slice(0, 80),
      ...(o.topic && { topic: o.topic.slice(0, 280) }),
      members: o.members,
    },
  );
  return { id: r.conversation.id, skipped: r.skipped ?? [] };
}

export async function addToConnectGroup(id: string, members: string[]): Promise<void> {
  await call('POST', `/api/v1/bots/groups/${encodeURIComponent(id)}/members`, { members });
}

/**
 * A person's calls in a range (K4), booked anywhere in Connect: the ones they
 * host or are invited to. Needs `GET /api/v1/bots/people/:person/convenes` in
 * our Connect (docs/connect-changes.md); null while Connect has no such call.
 */
export async function listPersonCalls(
  email: string,
  from: Date,
  to: Date,
): Promise<
  | {
      id: string;
      title: string;
      startAt: string;
      endAt: string | null;
      status: string;
      joinUrl: string;
      host: string;
      externalRef?: string | null;
    }[]
  | null
> {
  try {
    const q = new URLSearchParams({ from: from.toISOString(), to: to.toISOString() });
    const r = await call<{ calls: never[] }>(
      'GET',
      `/api/v1/bots/people/${encodeURIComponent(email)}/convenes?${q.toString()}`,
    );
    return r.calls ?? [];
  } catch (err) {
    if (err instanceof ConnectError && err.status === 404) return null;
    throw err;
  }
}
