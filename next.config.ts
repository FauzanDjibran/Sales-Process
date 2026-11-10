import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    /**
     * Enables `forbidden()` and the `forbidden.tsx` convention, so an
     * authorization refusal renders its own screen with a real 403 rather than
     * surfacing as a generic server error. See
     * `src/lib/erp/auth.ts` and `src/app/forbidden.tsx`.
     */
    authInterrupts: true,
  },
  /**
   * Menus that moved between the two applications (P257) keep their old links
   * working: bookmarks, and links already sent around. Temporary, so they can
   * go once nobody uses the old addresses.
   */
  async redirects() {
    return [
      { source: "/production/cost-bill/:path*", destination: "/costing/cost-bill/:path*", permanent: false },
      { source: "/master/rate-version/:path*", destination: "/costing/rate-version/:path*", permanent: false },
      { source: "/master/cost-type/:path*", destination: "/costing/cost-type/:path*", permanent: false },
      { source: "/master/employee/:path*", destination: "/production/employee/:path*", permanent: false },
    ];
  },
};

export default nextConfig;
