import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  allowedDevOrigins: ["127.0.0.1", "localhost", "10.10.40.101"],
  typescript: {
    // Type checking is done during development; skip during Docker builds
    ignoreBuildErrors: true,
  },
  transpilePackages: [
    "@click-deploy/api",
    "@click-deploy/database",
    "@click-deploy/shared",
  ],
  serverExternalPackages: ["drizzle-orm", "postgres", "ssh2", "cpu-features", "nodemailer"],
};

export default nextConfig;
