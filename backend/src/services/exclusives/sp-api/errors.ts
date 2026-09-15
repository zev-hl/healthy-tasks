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
