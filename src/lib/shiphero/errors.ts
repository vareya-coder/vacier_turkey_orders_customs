/**
 * Base error class for ShipHero API errors
 */
export class ShipHeroError extends Error {
  constructor(
    message: string,
    public code?: string,
    public statusCode?: number,
    public details?: unknown
  ) {
    super(message);
    this.name = 'ShipHeroError';
    Object.setPrototypeOf(this, ShipHeroError.prototype);
  }
}

/**
 * Authentication error (401 or token issues)
 */
export class ShipHeroAuthError extends ShipHeroError {
  constructor(message: string, details?: unknown) {
    super(message, 'AUTH_ERROR', 401, details);
    this.name = 'ShipHeroAuthError';
    Object.setPrototypeOf(this, ShipHeroAuthError.prototype);
  }
}

/**
 * Rate limit / quota exceeded error (429)
 */
export class ShipHeroQuotaError extends ShipHeroError {
  constructor(
    message: string,
    public remainingCredits?: number,
    public retryAfterMs?: number
  ) {
    super(message, 'QUOTA_EXCEEDED', 429, { remainingCredits, retryAfterMs });
    this.name = 'ShipHeroQuotaError';
    Object.setPrototypeOf(this, ShipHeroQuotaError.prototype);
  }
}

/**
 * GraphQL error from ShipHero API
 */
export class ShipHeroGraphQLError extends ShipHeroError {
  constructor(message: string, public graphqlErrors?: unknown[]) {
    super(message, 'GRAPHQL_ERROR', undefined, graphqlErrors);
    this.name = 'ShipHeroGraphQLError';
    Object.setPrototypeOf(this, ShipHeroGraphQLError.prototype);
  }
}

/**
 * Network or connectivity error
 */
export class ShipHeroNetworkError extends ShipHeroError {
  constructor(message: string, details?: unknown) {
    super(message, 'NETWORK_ERROR', undefined, details);
    this.name = 'ShipHeroNetworkError';
    Object.setPrototypeOf(this, ShipHeroNetworkError.prototype);
  }
}

/**
 * Validation error (bad request data)
 */
export class ShipHeroValidationError extends ShipHeroError {
  constructor(message: string, details?: unknown) {
    super(message, 'VALIDATION_ERROR', 400, details);
    this.name = 'ShipHeroValidationError';
    Object.setPrototypeOf(this, ShipHeroValidationError.prototype);
  }
}

/**
 * Type guard to check if error is a ShipHero error
 */
export function isShipHeroError(error: unknown): error is ShipHeroError {
  return error instanceof ShipHeroError;
}

/**
 * Type guard to check if error is retryable
 */
export function isRetryableError(error: unknown): boolean {
  if (!isShipHeroError(error)) return false;

  // Retry on network errors and 5xx server errors
  if (error instanceof ShipHeroNetworkError) return true;
  if (error.statusCode && error.statusCode >= 500) return true;

  return false;
}
