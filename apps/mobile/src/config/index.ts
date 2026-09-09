/**
 * Mobile App Build Configuration
 *
 * Note: DEFAULT_API_URL defines the default backend server endpoint.
 * - In local development / open source: Falls back to 'https://api.aetheroll.app' (or your local IP).
 * - In production release builds: Injected by CI/CD (.github/workflows/mobile-release.yml)
 *   via the MOBILE_API_URL secret / variable.
 * - In runtime: Users can also customize their backend URL anytime via the Settings modal.
 */
import envConfig from './env.json';

// This should be your live backend API URL (e.g. https://aetheroll-api.yourdomain.com)
export const DEFAULT_API_URL: string = envConfig?.API_URL || 'https://api.aetheroll.app';
