#!/usr/bin/env node
/**
 * 브라우저·방화벽 확인용 (Next와 무관). 기본 3010 — dev(3001)와 겹치지 않음.
 * 터미널: npm run check:port
 * 브라우저: http://127.0.0.1:3010
 */
const http = require("http");
const port = Number(process.env.PORT || 3010);
const host = "127.0.0.1";

const server = http.createServer((_req, res) => {
  res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
  res.end(
    "<!doctype html><meta charset=utf-8><title>포트 확인</title>" +
      "<p style=font-family:sans-serif>이 페이지가 보이면 이 맥에서 로컬 서버 접속은 됩니다. 이 탭을 닫고 프로젝트에서 <code>npm run dev</code> 후 <code>http://127.0.0.1:3000</code> (또는 터미널에 나온 포트)를 여세요.</p>"
  );
});

server.listen(port, host, () => {
  console.log("");
  console.log("  포트 확인 서버 실행 중");
  console.log("  → http://" + host + ":" + port);
  console.log("  (종료: Ctrl+C)");
  console.log("");
});
