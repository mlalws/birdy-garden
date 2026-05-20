import type { Metadata, Viewport } from "next";
import "./globals.css";
import "leaflet/dist/leaflet.css";

export const metadata: Metadata = {
  title: "Birdy Garden",
  description: "오늘 발견한 새를 정원에 기록하는 힐링 웹사이트",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ko" className="h-full font-sans antialiased">
      <head>
        <link rel="preload" href="/fonts/NanumSquareRoundB.ttf" as="font" type="font/ttf" crossOrigin="anonymous" />
        <link rel="preload" href="/x.png" as="image" />
        <link rel="preload" href="/left.png" as="image" />
      </head>
      <body className="min-h-full flex flex-col font-sans">{children}</body>
    </html>
  );
}
