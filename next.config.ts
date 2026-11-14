import type { NextConfig } from "next";

const isProd = process.env.NODE_ENV === "production";
// When running `tauri dev` on a mobile device or over the network, Tauri sets
// TAURI_DEV_HOST so the webview can reach the Next dev server.
const internalHost = process.env.TAURI_DEV_HOST || "localhost";

const nextConfig: NextConfig = {
  // Tauri serves the frontend as static files from disk — there is no Node
  // server at runtime — so export the app as a client-rendered SPA.
  // https://nextjs.org/docs/app/guides/static-exports
  output: "export",
  reactCompiler: true,
  // next/image optimization requires a server; disable it for static export.
  // https://nextjs.org/docs/messages/export-image-api
  images: {
    unoptimized: true,
  },
  // In dev, assets must resolve against the Next dev server the Tauri webview
  // points at (devUrl). In production the app loads assets from the bundled
  // `out/` directory relative to the webview, so no prefix is needed.
  assetPrefix: isProd ? undefined : `http://${internalHost}:3000`,
};

export default nextConfig;
