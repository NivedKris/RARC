import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  turbopack: {
    rules: {
      "*.css": { loaders: ["@tailwindcss/turbopack"], as: "*.css" },
    },
  },
  serverExternalPackages: ["quickjs-emscripten", "quickjs-emscripten-core", "@jitl/quickjs-wasmfile-release-sync"],
  outputFileTracingIncludes: {
    "/api/**": [
      "./node_modules/quickjs-emscripten/**",
      "./node_modules/quickjs-emscripten-core/**",
      "./node_modules/quickjs-ffi-types/**",
      "./node_modules/@jitl/quickjs-wasmfile-release-sync/**",
      "./data/llm-cache.json",
      "./data/embeddings.json",
    ],
  },
};

export default nextConfig;
