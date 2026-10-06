/** Operational error that maps to a stable `{success:false,error:{code,message}}` response. */
export class AppError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly headers: Record<string, string> = {},
  ) {
    super(message);
    this.name = 'AppError';
  }

  static badRequest(code: string, message: string) {
    return new AppError(400, code, message);
  }
  static unauthorized(message = 'Authentication required.') {
    return new AppError(401, 'UNAUTHORIZED', message);
  }
  static forbidden(code: string, message: string) {
    return new AppError(403, code, message);
  }
  static notFound(message = 'Not found.') {
    return new AppError(404, 'NOT_FOUND', message);
  }
  static conflict(code: string, message: string) {
    return new AppError(409, code, message);
  }
  static tooMany(retryAfterSec: number, message = 'Too many requests. Please slow down.') {
    return new AppError(429, 'RATE_LIMITED', message, {
      'retry-after': String(Math.max(1, Math.ceil(retryAfterSec))),
    });
  }
}
