"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";

const PAGES = [
  { label: "Summary",              href: "/" },
  { label: "Off-Market",           href: "/off-market" },
  { label: "On Market",            href: "/on-market" },
  { label: "Future Move-In",       href: "/future-move-in" },
  { label: "Collections",          href: "/collections" },
  { label: "Renewals / Move-Outs", href: "/renewals" },
  { label: "Turnkey",              href: "/turnkey" },
  { label: "Maintenance",          href: "/maintenance" },
  { label: "DRC",                  href: "/drc" },
];

export function PageNav() {
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(false);

  if (collapsed) {
    return (
      <div style={{
        width: 28,
        flexShrink: 0,
        background: "#fff",
        borderRight: "1px solid #e0e0e0",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        paddingTop: 12,
      }}>
        <button
          onClick={() => setCollapsed(false)}
          style={{
            background: "none",
            border: "none",
            cursor: "pointer",
            fontSize: 13,
            color: "#666",
            padding: "4px 2px",
            lineHeight: 1,
          }}
          title="Expand pages"
        >
          »
        </button>
      </div>
    );
  }

  return (
    <div style={{
      width: 220,
      flexShrink: 0,
      background: "#fff",
      borderRight: "1px solid #e0e0e0",
      display: "flex",
      flexDirection: "column",
      userSelect: "none",
    }}>

      {/* ── Header row ── */}
      <div style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "16px 16px 10px 16px",
        borderBottom: "1px solid #f0f0f0",
      }}>
        <span style={{
          fontSize: 14,
          fontWeight: 700,
          color: "#1f2937",
          letterSpacing: 0,
        }}>
          Pages
        </span>
        <button
          onClick={() => setCollapsed(true)}
          style={{
            background: "none",
            border: "none",
            cursor: "pointer",
            fontSize: 13,
            color: "#888",
            padding: "2px 4px",
            lineHeight: 1,
            borderRadius: 3,
          }}
          title="Collapse"
        >
          «
        </button>
      </div>

      {/* ── Page list ── */}
      <nav style={{ flex: 1, padding: "6px 0" }}>
        {PAGES.map((p) => {
          const active = pathname === p.href;
          return (
            <Link
              key={p.href}
              href={p.href}
              style={{
                display: "flex",
                alignItems: "center",
                padding: "9px 16px",
                fontSize: 13,
                fontWeight: active ? 700 : 400,
                color: active ? "#1f2937" : "#374151",
                textDecoration: "none",
                background: active ? "#f0f0f0" : "transparent",
                borderLeft: active ? "3px solid #1a7a4a" : "3px solid transparent",
                position: "relative" as const,
                transition: "background 0.1s",
              }}
              onMouseEnter={e => {
                if (!active) (e.currentTarget as HTMLAnchorElement).style.background = "#f8f8f8";
              }}
              onMouseLeave={e => {
                if (!active) (e.currentTarget as HTMLAnchorElement).style.background = "transparent";
              }}
            >
              {p.label}
            </Link>
          );
        })}
      </nav>

    </div>
  );
}
