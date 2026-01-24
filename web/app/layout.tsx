import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "TickPay - Per-Second Video Billing on Monad",
  description: "EIP-7702 video streaming billing demo on Monad blockchain",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
