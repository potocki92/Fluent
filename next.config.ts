import type { NextConfig } from "next";

/**
 * The ONE remote host `next/image` may optimize from.
 *
 * Narrow on purpose, and narrow in three ways at once: this project's Supabase
 * host, the public-object path of the ONE bucket that holds material artwork,
 * and no query string. `hostname: "**"` would turn Fluent's image optimizer into
 * an open proxy that anybody could point at any URL on the internet and have
 * fetched, resized and cached under our domain.
 *
 * Built from `NEXT_PUBLIC_SUPABASE_URL` rather than hardcoded, so a staging
 * project does not silently optimize production's images. When the variable is
 * absent — a lint run or a type check with no environment — the list is empty
 * and every remote image is refused, which is the safe direction to fail.
 */
function supabaseCoverPattern() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!url) return [];

  try {
    const { protocol, hostname, port } = new URL(url);
    return [
      {
        protocol: protocol.replace(":", "") as "http" | "https",
        hostname,
        port,
        pathname: "/storage/v1/object/public/content-covers/**",
        search: "",
      },
    ];
  } catch {
    return [];
  }
}

const nextConfig: NextConfig = {
  images: {
    remotePatterns: supabaseCoverPattern(),
  },
};

export default nextConfig;
