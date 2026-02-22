/** @type {import('next').NextConfig} */
const backendProxyTarget = process.env.NEXT_DEV_BACKEND_URL || 'http://127.0.0.1:3000';

const nextConfig = {
  output: 'standalone',
  reactStrictMode: true,
  env: {
    // Backward-compat mapping from legacy Vite env names.
    NEXT_PUBLIC_DEV_API_URL: process.env.NEXT_PUBLIC_DEV_API_URL || process.env.VITE_DEV_API_URL || '',
    NEXT_PUBLIC_API_URL: process.env.NEXT_PUBLIC_API_URL || process.env.VITE_API_URL || '',
    NEXT_PUBLIC_API_TIMEOUT_MS:
      process.env.NEXT_PUBLIC_API_TIMEOUT_MS || process.env.VITE_API_TIMEOUT_MS || '',
  },
  async rewrites() {
    if (process.env.NEXT_DISABLE_API_PROXY === '1') return [];
    return [
      {
        source: '/api/:path*',
        destination: `${backendProxyTarget.replace(/\/$/, '')}/api/:path*`,
      },
    ];
  },
};

export default nextConfig;
