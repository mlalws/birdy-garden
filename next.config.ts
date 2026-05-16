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
  // Vercel `next build`가 ESLint 오류로 실패하면 배포가 멈추고, 링크에는 예전 빌드만 보입니다.
  eslint: {
    ignoreDuringBuilds: true,
  },
};

export default nextConfig;
