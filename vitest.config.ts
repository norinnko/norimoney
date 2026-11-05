import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // 給料計算は純粋関数なので DOM は不要。node 環境で十分。
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
