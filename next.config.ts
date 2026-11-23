import type { NextConfig } from "next";
import { withSentryConfig } from "@sentry/nextjs";

const nextConfig: NextConfig = {
  // @fomo/rentman-core reads its config/*.json next to its own files at run time (website listings), so it must stay
  // a real package in node_modules rather than be bundled, and those files must ship with the functions.
  serverExternalPackages: ["@fomo/rentman-core"],
  outputFileTracingIncludes: { "/api/**": ["./node_modules/@fomo/rentman-core/config/**"] },
};

export default withSentryConfig(nextConfig, { silent: true, telemetry: false });
