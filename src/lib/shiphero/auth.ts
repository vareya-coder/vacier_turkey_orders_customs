import { env } from '../env';
import { config } from '../config';
import { ShipHeroAuthError, ShipHeroNetworkError } from './errors';
import { kv } from '@vercel/kv';
import { createLogger } from '../logging/axiom';

const logger = createLogger({ service: 'shiphero-auth' });

const KV_ACCESS_TOKEN_KEY = 'shiphero:access_token';
const KV_EXPIRES_AT_KEY = 'shiphero:expires_at';

// Check if KV is configured
function isKVConfigured(): boolean {
  return !!(env.UPSTASH_REDIS_REST_URL && env.UPSTASH_REDIS_REST_TOKEN);
}

interface TokenResponse {
  access_token: string;
  expires_in: number;      // Seconds until expiration (28 days = 2419200)
  scope: string;
  token_type: string;
  // Note: refresh_token is NOT returned by /auth/refresh endpoint
}

/**
 * ShipHero authentication manager
 * Handles token management and automatic refresh
 */
export class ShipHeroAuth {
  private accessToken: string;
  private refreshToken: string;
  private tokenExpiryTime: number | null = null;
  private isRefreshing = false;
  private refreshPromise: Promise<void> | null = null;

  constructor() {
    this.refreshToken = env.SHIPHERO_REFRESH_TOKEN;
    // Access token loaded from KV on-demand via getValidToken()
    // Keep env var as fallback for when KV not configured
    this.accessToken = env.SHIPHERO_ACCESS_TOKEN;
    this.tokenExpiryTime = null;
  }

  /**
   * Get a valid access token (refresh if necessary)
   */
  async getValidToken(): Promise<string> {
    // Try to get token from KV first (if configured)
    if (isKVConfigured()) {
      try {
        const [cachedToken, expiresAt] = await Promise.all([
          kv.get<string>(KV_ACCESS_TOKEN_KEY),
          kv.get<number>(KV_EXPIRES_AT_KEY),
        ]);

        if (cachedToken && expiresAt) {
          const now = Date.now();
          const fiveMinutes = 5 * 60 * 1000;

          // Check if token is still valid (with 5-min buffer)
          if (now < expiresAt - fiveMinutes) {
            logger.debug('order_processing', 'Using cached token from KV', {
              expiresAt: new Date(expiresAt).toISOString(),
              remainingMs: expiresAt - now,
            });
            return cachedToken;
          }
        }
      } catch (error) {
        logger.warn('batch_error', 'Failed to read from KV, falling back to refresh', {
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    // Token not in KV or expired - refresh it
    if (this.isTokenExpired() || !this.accessToken) {
      await this.refreshTokens();
    }

    // If another request is already refreshing, wait for it
    if (this.isRefreshing && this.refreshPromise) {
      await this.refreshPromise;
    }

    return this.accessToken;
  }

  /**
   * Check if the current token is expired
   */
  isTokenExpired(): boolean {
    if (!this.tokenExpiryTime) {
      // Don't know expiry time yet, assume valid
      return false;
    }

    // Refresh 5 minutes before expiry
    const fiveMinutes = 5 * 60 * 1000;
    return Date.now() >= this.tokenExpiryTime - fiveMinutes;
  }

  /**
   * Refresh the access token using the refresh token
   */
  async refreshTokens(): Promise<void> {
    // Prevent concurrent refresh requests
    if (this.isRefreshing && this.refreshPromise) {
      return this.refreshPromise;
    }

    this.isRefreshing = true;
    this.refreshPromise = this._performRefresh();

    try {
      await this.refreshPromise;
    } finally {
      this.isRefreshing = false;
      this.refreshPromise = null;
    }
  }

  /**
   * Internal method to perform the actual token refresh
   */
  private async _performRefresh(): Promise<void> {
    try {
      logger.info('batch_started', 'Refreshing ShipHero access token', {
        timestamp: new Date().toISOString(),
      });

      const response = await fetch(config.shiphero.authUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          refresh_token: this.refreshToken,
        }),
      });

      if (!response.ok) {
        const errorText = await response.text().catch(() => 'Unknown error');
        logger.error('batch_error', 'Token refresh HTTP error', {
          status: response.status,
          statusText: response.statusText,
          body: errorText,
        });
        throw new ShipHeroAuthError(
          `Token refresh failed: ${response.status} ${response.statusText}`,
          { status: response.status, body: errorText }
        );
      }

      const data = (await response.json()) as TokenResponse;

      // Log response structure for debugging (without sensitive token)
      logger.debug('order_processing', 'Token refresh response received', {
        hasAccessToken: !!data.access_token,
        expiresIn: data.expires_in,
        scope: data.scope,
        tokenType: data.token_type,
      });

      // Validate response - only check fields that ShipHero actually returns
      if (!data.access_token || !data.expires_in) {
        logger.error('batch_error', 'Invalid token response structure', {
          hasAccessToken: !!data.access_token,
          hasExpiresIn: !!data.expires_in,
          responseKeys: Object.keys(data),
        });
        throw new ShipHeroAuthError(
          'Invalid token response: missing access_token or expires_in',
          data
        );
      }

      // Update in-memory token (fallback for when KV unavailable)
      this.accessToken = data.access_token;

      // Calculate actual expiry time from expires_in
      const expiresInMs = data.expires_in * 1000;
      const expiresAt = Date.now() + expiresInMs;
      this.tokenExpiryTime = expiresAt;

      // Persist to KV if configured
      if (isKVConfigured()) {
        try {
          await Promise.all([
            kv.set(KV_ACCESS_TOKEN_KEY, data.access_token, {
              ex: data.expires_in, // TTL in seconds
            }),
            kv.set(KV_EXPIRES_AT_KEY, expiresAt, {
              ex: data.expires_in,
            }),
          ]);

          logger.info('batch_completed', 'Token refreshed and cached in KV', {
            expiresAt: new Date(expiresAt).toISOString(),
            expiresInSeconds: data.expires_in,
            expiresInDays: Math.floor(data.expires_in / 86400),
          });
        } catch (error) {
          logger.warn('batch_error', 'Failed to cache token in KV, continuing with in-memory', {
            error: error instanceof Error ? error.message : String(error),
          });
        }
      } else {
        logger.info('batch_completed', 'Token refreshed (KV not configured, using in-memory only)', {
          expiresAt: new Date(expiresAt).toISOString(),
          expiresInDays: Math.floor(data.expires_in / 86400),
        });
      }
    } catch (error) {
      if (error instanceof ShipHeroAuthError) {
        throw error;
      }

      // Network or other errors
      logger.error('batch_error', 'Token refresh failed with exception', {
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
      });

      throw new ShipHeroNetworkError(
        `Failed to refresh ShipHero tokens: ${error instanceof Error ? error.message : 'Unknown error'}`,
        error
      );
    }
  }

  /**
   * Force a token refresh (useful after 401 errors)
   */
  async forceRefresh(): Promise<void> {
    this.tokenExpiryTime = 0; // Mark as expired
    await this.refreshTokens();
  }
}

// Singleton instance
let authInstance: ShipHeroAuth | null = null;

/**
 * Get the singleton ShipHero auth instance
 */
export function getShipHeroAuth(): ShipHeroAuth {
  if (!authInstance) {
    authInstance = new ShipHeroAuth();
  }
  return authInstance;
}
