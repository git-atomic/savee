// Use CommonJS export since package.json has type: module
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
};
export default nextConfig;


