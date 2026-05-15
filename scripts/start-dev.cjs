#!/usr/bin/env node
const { spawn } = require("child_process");
const path = require("path");
const fs = require("fs");
const net = require("net");

const root = path.join(__dirname, "..");
const node22 = "/opt/homebrew/opt/node@22/bin/node";

if (fs.existsSync(node22) && Number((process.version || "v0").slice(1).split(".")[0]) >= 24) {
  const reexec = spawn(node22, [__filename], {
    cwd: root,
    stdio: "inherit",
    env: process.env,
  });
  reexec.on("exit", (code, signal) => process.exit(signal ? 1 : (code ?? 0)));
  return;
}

const nextBin = path.join(root, "node_modules", "next", "dist", "bin", "next");

if (!fs.existsSync(nextBin)) {
  console.error("next를 찾을 수 없습니다. 이 폴더에서 npm install 을 실행하세요.");
  console.error(nextBin);
  process.exit(1);
}

const port = process.env.PORT || "3000";
// Next 기본 호스트: -H 미지정 시 CLI 기본값 사용.
// 일부 Mac은 "localhost"가 IPv6(::1)라 127.0.0.1 이 더 잘 됩니다.
const host = process.env.HOST || "127.0.0.1";
// Node 24 등에서 Turbopack 첫 기동이 멈춘 것처럼 보일 수 있어 기본은 Webpack.
const useWebpack = process.env.NEXT_DEV_WEBPACK !== "0";

const major = Number((process.version || "v20").slice(1).split(".")[0]);
if (major >= 24) {
  console.warn("");
  console.warn("  ⚠ Node " + process.version + " 는 Next와 조합 시 개발 서버가 안 뜨는 경우가 있습니다.");
  console.warn("     권장: nvm으로 Node 22 LTS 사용 → https://nodejs.org/");
  console.warn("");
}

const args = [nextBin, "dev", "-p", port, "-H", host];
if (useWebpack) {
  args.push("--webpack");
}

console.log("");
console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
console.log("  Birdy Garden — 개발 서버");
console.log("  브라우저 → http://127.0.0.1:" + port);
console.log("         또는 http://localhost:" + port);
console.log("  폴더 → " + root);
console.log("  첫 실행은 컴파일 때문에 1~3분 걸릴 수 있습니다.");
console.log("  아래에 「준비됨」이 뜨면 바로 브라우저를 여세요. (Next가 Local 을 안 찍어도 됩니다)");
if (!useWebpack) {
  console.log("  (기본 Webpack 끄려면: NEXT_DEV_WEBPACK=0 npm run dev)");
} else {
  console.log("  (Turbopack 시도: NEXT_DEV_WEBPACK=0 npm run dev)");
}
console.log("  로컬·방화벽만 확인: npm run check:port (기본 3010)");
console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
console.log("");

const child = spawn(process.execPath, args, {
  cwd: root,
  stdio: "inherit",
  env: {
    ...process.env,
    FORCE_COLOR: "1",
    NEXT_TELEMETRY_DISABLED: "1",
  },
});

let portReadyPrinted = false;
const portNum = Number(port);
const probeEveryMs = 500;
const maxProbeMs = 240_000;
const probeStarted = Date.now();

function probeListen() {
  if (portReadyPrinted) return;
  if (Date.now() - probeStarted > maxProbeMs) {
    console.error("");
    console.error("  ✗ " + portNum + "번 포트가 " + maxProbeMs / 60000 + "분 안에 열리지 않았습니다.");
    console.error("     1) rm -rf .next && npm run dev");
    console.error("     2) Node 22 LTS 사용 (현재 " + process.version + ")");
    console.error("     3) 다른 앱이 포트를 쓰면: PORT=3001 npm run dev");
    console.error("");
    return;
  }
  const socket = net.connect({ host: "127.0.0.1", port: portNum });
  socket.setTimeout(900);
  socket.once("connect", () => {
    socket.destroy();
    if (portReadyPrinted) return;
    portReadyPrinted = true;
    console.log("");
    console.log("  ✓ 준비됨 — 브라우저에서 여세요:");
    console.log("    http://127.0.0.1:" + portNum);
    console.log("    http://localhost:" + portNum);
    console.log("");
  });
  socket.once("error", () => {
    socket.destroy();
    setTimeout(probeListen, probeEveryMs);
  });
  socket.once("timeout", () => {
    socket.destroy();
    setTimeout(probeListen, probeEveryMs);
  });
}

setTimeout(probeListen, 600);

child.on("exit", (code, signal) => {
  if (signal) process.exit(1);
  process.exit(code ?? 0);
});
