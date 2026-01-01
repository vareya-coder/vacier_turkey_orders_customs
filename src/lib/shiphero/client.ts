import { config } from '../config';
import { createLogger } from '../logging/axiom';
import { getShipHeroAuth } from './auth';
import {
  ShipHeroError,
  ShipHeroAuthError,
  ShipHeroQuotaError,
  ShipHeroGraphQLError,
  ShipHeroNetworkError,
  isRetryableError,
} from './errors';

const logger = createLogger({ service: 'shiphero-client' });

interface GraphQLResponse<T = unknown> {
  data?: T;
  errors?: Array<{
    message: string;
    locations?: Array<{ line: number; column: number }>;
    path?: string[];
    extensions?: Record<string, unknown>;
  }>;
  extensions?: {
    request_id?: string;
    complexity?: number;
    credits?: {
      used?: number;
      remaining?: number;
    };
  };
}

interface RequestOptions {
  maxRetries?: number;
  retryDelay?: number;
}

/**
 * ShipHero GraphQL client
 * Handles authentication, retries, and error handling
 */
export class ShipHeroClient {
  private auth = getShipHeroAuth();
  private requestCount = 0;

  /**
   * Execute a GraphQL query or mutation
   */
  async request<T = unknown>(
    query: string,
    variables?: Record<string, unknown>,
    options: RequestOptions = {}
  ): Promise<GraphQLResponse<T>> {
    const { maxRetries = 3, retryDelay = 1000 } = options;
    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        return await this._executeRequest<T>(query, variables);
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));

        // Don't retry on auth errors or validation errors
        if (error instanceof ShipHeroAuthError || error instanceof ShipHeroGraphQLError) {
          throw error;
        }

        // Don't retry on quota errors (handle separately)
        if (error instanceof ShipHeroQuotaError) {
          throw error;
        }

        // Retry on network errors and 5xx errors
        if (isRetryableError(error) && attempt < maxRetries) {
          const delay = retryDelay * Math.pow(2, attempt); // Exponential backoff
          logger.warn('batch_error', `Request failed, retrying in ${delay}ms (attempt ${attempt + 1}/${maxRetries})`, {
            error: lastError.message,
            attempt: attempt + 1,
          });
          await this._sleep(delay);
          continue;
        }

        // Non-retryable error or max retries reached
        throw error;
      }
    }

    // Should never reach here, but TypeScript needs it
    throw lastError || new ShipHeroError('Request failed after all retries');
  }

  /**
   * Internal method to execute a single request
   */
  private async _executeRequest<T>(
    query: string,
    variables?: Record<string, unknown>
  ): Promise<GraphQLResponse<T>> {
    this.requestCount++;
    const requestId = `req_${this.requestCount}_${Date.now()}`;

    // Get valid token
    const token = await this.auth.getValidToken();

    // Log request (without sensitive data)
    logger.debug('order_processing', 'Sending GraphQL request', {
      requestId,
      operationType: this._extractOperationType(query),
      variablesCount: variables ? Object.keys(variables).length : 0,
    });

    let response: Response;
    try {
      response = await fetch(config.shiphero.apiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          query,
          variables: variables || {},
        }),
      });
    } catch (error) {
      throw new ShipHeroNetworkError(
        `Network request failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
        error
      );
    }

    // Handle HTTP errors
    if (response.status === 401) {
      // Token expired, try refreshing
      logger.warn('batch_error', 'Received 401, attempting token refresh', { requestId });
      await this.auth.forceRefresh();
      throw new ShipHeroAuthError('Authentication failed, token refreshed - please retry');
    }

    if (response.status === 429) {
      const retryAfter = response.headers.get('Retry-After');
      const retryAfterMs = retryAfter ? parseInt(retryAfter, 10) * 1000 : undefined;
      throw new ShipHeroQuotaError('Rate limit exceeded', undefined, retryAfterMs);
    }

    if (!response.ok) {
      const errorText = await response.text().catch(() => 'Unknown error');
      throw new ShipHeroError(
        `HTTP ${response.status}: ${response.statusText}`,
        'HTTP_ERROR',
        response.status,
        errorText
      );
    }

    // Parse response
    let data: GraphQLResponse<T>;
    try {
      data = (await response.json()) as GraphQLResponse<T>;
    } catch (error) {
      throw new ShipHeroError(
        'Failed to parse response JSON',
        'PARSE_ERROR',
        undefined,
        error
      );
    }

    // Log response metadata
    const complexity = data.extensions?.complexity;
    const requestIdFromServer = data.extensions?.request_id;
    const credits = data.extensions?.credits;

    logger.debug('order_processing', 'Received GraphQL response', {
      requestId,
      serverRequestId: requestIdFromServer,
      complexity,
      creditsUsed: credits?.used,
      creditsRemaining: credits?.remaining,
      hasErrors: !!data.errors,
      hasData: !!data.data,
    });

    // Handle GraphQL errors
    if (data.errors && data.errors.length > 0) {
      const errorMessages = data.errors.map((e) => e.message).join(', ');
      throw new ShipHeroGraphQLError(
        `GraphQL errors: ${errorMessages}`,
        data.errors
      );
    }

    return data;
  }

  /**
   * Extract operation type from query string (query/mutation)
   */
  private _extractOperationType(query: string): string {
    const match = query.trim().match(/^(query|mutation)/i);
    return match ? match[1].toLowerCase() : 'unknown';
  }

  /**
   * Sleep helper for retries
   */
  private _sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

// Singleton instance
let clientInstance: ShipHeroClient | null = null;

/**
 * Get the singleton ShipHero client instance
 */
export function getShipHeroClient(): ShipHeroClient {
  if (!clientInstance) {
    clientInstance = new ShipHeroClient();
  }
  return clientInstance;
}
