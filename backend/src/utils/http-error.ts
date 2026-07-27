/**
 * An error with an associated HTTP status code. Thrown anywhere in the request
 * path (services, controllers) and translated to a JSON response by the central
 * error-handling middleware.
 */
export class HttpError extends Error {
  status: number;
  details?: unknown;

  constructor(status: number, message: string, details?: unknown) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
    this.details = details;
  }

  static badRequest(message: string, details?: unknown): HttpError {
    return new HttpError(400, message, details);
  }
  static unauthorized(message = 'Unauthorized'): HttpError {
    return new HttpError(401, message);
  }
  static forbidden(message = 'Forbidden'): HttpError {
    return new HttpError(403, message);
  }
  static notFound(message = 'Not found'): HttpError {
    return new HttpError(404, message);
  }
  static conflict(message: string): HttpError {
    return new HttpError(409, message);
  }
}
