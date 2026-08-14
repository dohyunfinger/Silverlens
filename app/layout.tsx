import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { headers } from "next/headers";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export async function generateMetadata(): Promise<Metadata> {
  const requestHeaders = await headers();
  const host = requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host");
  const protocol = requestHeaders.get("x-forwarded-proto") ?? "https";
  const origin = host ? `${protocol}://${host}` : "https://silverlens.ogq.workers.dev";
  const imageUrl = new URL("/og.png", origin).toString();
  const title = "실버렌즈 | 시니어 식생활 AI";
  const description = "말하고, 찍고, 편하게 묻는 시니어 맞춤 음식·건강 AI 서비스";

  return {
    title,
    description,
    icons: {
      icon: "/brand/silverlens-mark.png",
      shortcut: "/brand/silverlens-mark.png",
      apple: "/brand/silverlens-mark.png",
    },
    openGraph: {
      title,
      description,
      type: "website",
      images: [{ url: imageUrl, width: 1536, height: 1024, alt: "실버렌즈 시니어 식생활 AI" }],
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: [imageUrl],
    },
  };
}

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
