/** @type {import('next').NextConfig} */
const nextConfig = {
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
