import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Axiom logging is handled via @axiomhq/js client (see src/lib/logging/axiom.ts)
  // No withAxiom wrapper needed for the newer package

  // Enable strict mode for better development experience
  reactStrictMode: true,

  // Optimize for production builds
  poweredByHeader: false,

  // Environment variables exposed to the browser (if needed)
  // env: {},
};

export default nextConfig;
