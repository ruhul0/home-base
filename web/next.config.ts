import type { NextConfig } from "next";

// The site is exported as static files. The Go server serves them, and the
// extension packages the same build, so production needs no Node server.
const nextConfig: NextConfig = {
  output: "export",
  images: { unoptimized: true },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
