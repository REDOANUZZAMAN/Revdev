import { withSentryConfig } from "@sentry/nextjs";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Mark heavy / optional Node-only deps as external so webpack doesn't try to bundle them.
  // Fixes "Module not found: '@opentelemetry/winston-transport'" / "'undici'" warnings,
  // which were ballooning the dev build into a JS heap OOM.
  serverExternalPackages: [
    "@opentelemetry/auto-instrumentations-node",
    "@opentelemetry/instrumentation-winston",
    "@opentelemetry/winston-transport",
    "@mendable/firecrawl-js",
    "undici",
  ],
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          {
            key: "Cross-Origin-Embedder-Policy", value: "credentialless"
          },
          {
            key: "Cross-Origin-Opener-Policy", value: "same-origin"
          },
        ],
      }
    ];
  }
};

export default withSentryConfig(nextConfig, {
  // For all available options, see:
  // https://www.npmjs.com/package/@sentry/webpack-plugin#options

  org: "sudoshild",
  project: "revdev",

  // Only print logs for uploading source maps in CI
  silent: !process.env.CI,

  // For all available options, see:
  // https://docs.sentry.io/platforms/javascript/guides/nextjs/manual-setup/

  // Upload a larger set of source maps for prettier stack traces (increases build time)
  widenClientFileUpload: true,

  // Route browser requests to Sentry through a Next.js rewrite to circumvent ad-blockers.
  // Only enabled in production builds — in dev it complicates Clerk middleware
  // interaction and adds nothing (no ad-blockers on localhost).
  ...(process.env.NODE_ENV === "production" ? { tunnelRoute: "/monitoring" } : {}),

  webpack: {
    // Automatically tree-shake Sentry logger statements to reduce bundle size
    treeshake: {
      removeDebugLogging: true,
    },
    // Enables automatic instrumentation of Vercel Cron Monitors.
    // https://docs.sentry.io/product/crons/
    automaticVercelMonitors: true,
  },
});
