/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // The Power BI source mirror is reference-only; never bundle it.
  outputFileTracingExcludes: { "*": ["powerbi-source/**", ".ingest/**"] },
};
export default nextConfig;
