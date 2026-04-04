import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  typescript: {
    // Type checking is done during development; skip during Docker builds
    ignoreBuildErrors: true,
  },
  transpilePackages: [
    "@click-deploy/api",
    "@click-deploy/database",
    "@click-deploy/shared",
  ],
  serverExternalPackages: ["drizzle-orm", "postgres", "better-auth"],
};

export default nextConfig;
