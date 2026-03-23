/** @type {import('next').NextConfig} */
const nextConfig = {
  turbopack: {},
  images: {
    remotePatterns: [
      new URL("https://cards.scryfall.io/**"),
    ],
  },
};

export default nextConfig;
