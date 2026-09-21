export class SpApiAuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SpApiAuthError';
  }
}

export class SpApiWriteBlockedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SpApiWriteBlockedError';
  }
}

// Every attempt failed before Amazon answered (connection error or timeout).
// Transient by nature: the next scheduled sweep is the retry.
export class SpApiNetworkError extends Error {
  label: string;

  constructor(label: string, cause: unknown) {
    super(`SP-API ${label} got no response: ${(cause as Error)?.message ?? String(cause)}`, {
      cause,
    });
    this.name = 'SpApiNetworkError';
    this.label = label;
  }
}

export class SpApiError extends Error {
  status: number;
  method: string;
  path: string;
  body: unknown;

  constructor(status: number, method: string, path: string, body: unknown) {
    super(`SP-API ${method} ${path} failed (${status})`);
    this.name = 'SpApiError';
    this.status = status;
    this.method = method;
    this.path = path;
    this.body = body;
  }
}
