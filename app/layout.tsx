import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "ResiHome Summary",
  description: "ResiHome operations dashboard — Summary",
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
