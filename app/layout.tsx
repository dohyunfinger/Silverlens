import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "실버렌즈 | 시니어 맞춤 AI",
  description: "말하고 찍어서 편하게 확인하는 시니어 맞춤 식재료 AI 서비스",
  other: {
    "codex-preview": "development",
  },
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

/**
 * 이 선언이 없으면 폰이 980px 가상 화면으로 그린 뒤 축소해서 보여 준다.
 * 그러면 모바일용 규칙(@media 900px 이하)이 하나도 발동하지 않아
 * 사이드바가 세로로 눌리고 오른쪽이 잘린다.
 *
 * maximumScale 은 두지 않는다. 어르신이 손가락으로 확대할 수 있어야 한다.
 */
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ko">
      <head>
        <link rel="preconnect" href="https://cdn.jsdelivr.net" crossOrigin="anonymous" />
        <link
          rel="stylesheet"
          href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard/dist/web/static/pretendard.css"
        />
      </head>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        {children}
      </body>
    </html>
  );
}
