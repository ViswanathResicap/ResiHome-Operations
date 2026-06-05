/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // snowflake-sdk uses dynamic requires / Node built-ins — keep it external
  // (loaded at runtime) rather than bundled.
  serverExternalPackages: ["snowflake-sdk"],
  // The Power BI source mirror is reference-only; never bundle it.
  outputFileTracingExcludes: { "*": ["powerbi-source/**", ".ingest/**"] },
};
export default nextConfig;
