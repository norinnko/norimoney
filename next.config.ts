import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // 静的エクスポート: `next build` で out/ に静的ファイルを吐き、CORESERVER に FTP する。
  // SSR / API Routes は使わない（Node 常駐不可の共用サーバー前提）。
  output: "export",

  // 静的エクスポートでは next/image の最適化サーバーが使えないため無効化する。
  images: { unoptimized: true },

  // 各ルートを foo/index.html 形式で出力し、拡張子なし URL を静的ホスティングで解決させる。
  trailingSlash: true,
};

export default nextConfig;
