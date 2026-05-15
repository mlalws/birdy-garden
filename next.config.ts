import type { NextConfig } from "next";
import path from "path";
import { fileURLToPath } from "url";

// 상위 폴더(~/package-lock.json) 때문에 Next가 홈 디렉터리를 루트로 잡는 문제 방지
const projectRoot = path.dirname(fileURLToPath(import.meta.url));

const nextConfig: NextConfig = {
  outputFileTracingRoot: projectRoot,
  turbopack: {
    root: projectRoot,
  },
};

export default nextConfig;
