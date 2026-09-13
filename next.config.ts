import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // cool-nwc is a Node ESM package with native-free crypto; keep it external so
  // the serverless bundler does not try to inline its WASM-free noble deps.
  serverExternalPackages: ["cool-nwc"],
};

export default nextConfig;
