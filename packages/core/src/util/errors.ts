export type AppErrorCode =
  | 'not_found'
  | 'invalid_input'
  | 'conflict'
  | 'revision_conflict'
  | 'scope_violation'
  | 'dependency_blocked'
  | 'fencing_rejected'
  | 'lease_expired'
  | 'state_violation'
  | 'contact_conflict'
  | 'capability_unavailable'
  | 'access_denied'
  | 'rate_limited'
  | 'io_error'
  | 'integrity_error';

export class AppError extends Error {
  readonly code: AppErrorCode;
  readonly detail: Record<string, unknown>;
  readonly httpStatus: number;

  constructor(code: AppErrorCode, message: string, detail: Record<string, unknown> = {}) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.detail = detail;
    this.httpStatus = HTTP_STATUS[code];
  }

  toJSON(): Record<string, unknown> {
    return { error: this.code, message: this.message, detail: this.detail };
  }
}

const HTTP_STATUS: Record<AppErrorCode, number> = {
  not_found: 404,
  invalid_input: 400,
  conflict: 409,
  revision_conflict: 409,
  scope_violation: 409,
  dependency_blocked: 409,
  fencing_rejected: 409,
  lease_expired: 409,
  state_violation: 409,
  contact_conflict: 409,
  capability_unavailable: 501,
  access_denied: 403,
  rate_limited: 429,
  io_error: 500,
  integrity_error: 500,
};

export function isAppError(value: unknown): value is AppError {
  return value instanceof AppError;
}
