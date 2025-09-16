/** @type {import('next').NextConfig} */
const nextConfig = {
  eslint: {
    // Allow production builds to succeed even if there are ESLint errors.
    ignoreDuringBuilds: true,
  },
  typescript: {
    // Allow production builds to succeed even if there are TS type errors.
    // We keep this on to avoid blocking deploys; CI can enforce types separately.
    ignoreBuildErrors: true,
  },
  // Reduce noisy dev 404s for source maps in generated chunks
  // Remove deprecated devIndicators to avoid warnings
  // Disable sourcemap generation for app directory in dev to avoid .map 404 logs
  productionBrowserSourceMaps: false,
};
export default nextConfig;
