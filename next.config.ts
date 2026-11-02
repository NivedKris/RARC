import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  turbopack: {
    rules: {
      "*.css": { loaders: ["@tailwindcss/turbopack"], as: "*.css" },
    },
  },
  // The sandbox worker require()s QuickJS at runtime, which the bundler can't see, so the packages
  // stay external and every file they need is traced into the serverless function explicitly.
  serverExternalPackages: ["quickjs-emscripten", "quickjs-emscripten-core", "@jitl/quickjs-ffi-types", "@jitl/quickjs-wasmfile-release-sync"],
  outputFileTracingIncludes: {
    "/api/**": [
      "./node_modules/quickjs-emscripten/**",
      "./node_modules/quickjs-emscripten-core/**",
      "./node_modules/@jitl/**",
      "./data/llm-cache.json",
      "./data/embeddings.json",
    ],
  },
};

export default nextConfig;
