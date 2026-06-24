/** @type {import('next').NextConfig} */
const nextConfig = {
  // Shared workspace packages ship TS source, so Next must transpile them.
  transpilePackages: ['@shared/clients', '@shared/schemas', '@shared/types'],
};

export default nextConfig;
