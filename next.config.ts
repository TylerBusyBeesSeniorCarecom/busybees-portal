import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async headers() {
    return [
      {
        source: "/sheets-tools",
        headers: [
          {
            key: "Content-Security-Policy",
            value:
              "frame-ancestors https://docs.google.com https://*.googleusercontent.com https://script.google.com",
          },
        ],
      },
      {
        source: "/sheets-tools/:path*",
        headers: [
          {
            key: "Content-Security-Policy",
            value:
              "frame-ancestors https://docs.google.com https://*.googleusercontent.com https://script.google.com",
          },
        ],
      },
    ];
  },
};

export default nextConfig;
