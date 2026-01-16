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
      bodySizeLimit: "50mb", // Increase body size limit for chunk uploads
    },
  },
};

export default nextConfig;
