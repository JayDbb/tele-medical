import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    serverActions: {
      allowedOrigins: [
        "localhost:3000",
        "xw0pggn6-3000.use2.devtunnels.ms", // Your tunnel domain
        // Or use a wildcard pattern if the tunnel domain changes
        "*.devtunnels.ms",
      ],
    },
  },
};

export default nextConfig;
