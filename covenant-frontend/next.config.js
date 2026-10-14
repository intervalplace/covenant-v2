/** @type {import('next').NextConfig} */
const { execSync } = require("child_process");

// A deterministic build id (the git commit) instead of Next's random one, so
// the same source always produces byte-identical output — and the same IPFS
// CID. Anyone can rebuild a release and check it matches what's published.
function buildId() {
  if (process.env.BUILD_ID) return process.env.BUILD_ID;
  try { return execSync("git rev-parse --short=12 HEAD", { stdio: ["ignore", "pipe", "ignore"] }).toString().trim(); }
  catch { return "covenant"; }
}

const nextConfig = {
  // Fully static site in ./out: host it anywhere, including IPFS.
  output: "export",
  // /about -> /about/index.html, which every static host and IPFS gateway serves
  trailingSlash: true,
  images: { unoptimized: true },
  generateBuildId: async () => buildId(),
  // Shown in the footer when the app isn't served from IPFS
  env: { NEXT_PUBLIC_BUILD_ID: buildId() },
  webpack: (config) => {
    // Suppress missing module warning from wagmi's MetaMask connector
    // which optionally depends on @react-native-async-storage (not needed in browser)
    config.resolve.alias = {
      ...config.resolve.alias,
      "@react-native-async-storage/async-storage": false,
    };
    return config;
  },
};
module.exports = nextConfig;
