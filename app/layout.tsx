import type { Metadata } from "next";
import "./globals.css";
import { PageNav } from "@/components/PageNav";

export const metadata: Metadata = {
  title: "ResiHome Operations",
  description: "ResiHome Operations Dashboard",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body style={{ margin:0, padding:0, fontFamily:'"Segoe UI",Tahoma,sans-serif', display:"flex", height:"100vh", overflow:"hidden" }}>

        {/* ── Left Pages Nav (PBI style) ── */}
        <PageNav />

        {/* ── Page content ── */}
        <div style={{ flex:1, overflow:"auto" }}>
          {children}
        </div>

      </body>
    </html>
  );
}
