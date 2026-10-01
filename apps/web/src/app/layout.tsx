import type { Metadata } from "next";
import localFont from "next/font/local";
import "./globals.css";
const pretendard = localFont({
  src: "../fonts/PretendardVariable.woff2",
  display: "swap",
  weight: "100 900",
  variable: "--font-pretendard",
});
export const metadata: Metadata = {
  title: "ZeroNote — Your workspace",
  description: "로그인 없이 문서를 쓰고 함께 작업하는 Workspace",
  robots: { index: false, follow: false },
  manifest: "/manifest.webmanifest",
};
export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="ko" suppressHydrationWarning className={pretendard.variable}>
      <body>{children}</body>
    </html>
  );
}
