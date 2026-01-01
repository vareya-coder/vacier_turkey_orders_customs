import { env } from '../env';
import { config } from '../config';
import { ShipHeroAuthError, ShipHeroNetworkError } from './errors';

interface TokenResponse {
  access_token: string;
  refresh_token: string;
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
    this.accessToken = env.SHIPHERO_ACCESS_TOKEN;
    this.refreshToken = env.SHIPHERO_REFRESH_TOKEN;
    // ShipHero tokens typically expire after 12 hours (estimate)
    // We'll refresh proactively or on 401 errors
  }

  /**
   * Get a valid access token (refresh if necessary)
   */
  async getValidToken(): Promise<string> {
    // If token is expired or about to expire, refresh it
    if (this.isTokenExpired()) {
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
        throw new ShipHeroAuthError(
          `Token refresh failed: ${response.status} ${response.statusText}`,
          { status: response.status, body: errorText }
        );
      }

      const data = (await response.json()) as TokenResponse;

      if (!data.access_token || !data.refresh_token) {
        throw new ShipHeroAuthError('Invalid token response: missing tokens', data);
      }

      // Update tokens
      this.accessToken = data.access_token;
      this.refreshToken = data.refresh_token;

      // Set expiry time (12 hours from now, conservative estimate)
      this.tokenExpiryTime = Date.now() + 12 * 60 * 60 * 1000;

      console.log('ShipHero tokens refreshed successfully');
    } catch (error) {
      if (error instanceof ShipHeroAuthError) {
        throw error;
      }

      // Network or other errors
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
