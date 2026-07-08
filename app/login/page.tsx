"use client";

import { useState } from "react";

export default function LoginPage() {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    setLoading(true);
    try {
      const r = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ username, password }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || "Sign in failed. Please try again.");
      // Full navigation so middleware re-evaluates with the new cookie.
      const params = new URLSearchParams(window.location.search);
      const from = params.get("from");
      window.location.href = from && from.startsWith("/") ? from : "/";
    } catch (e) {
      setErr((e as Error).message);
      setLoading(false);
    }
  }

  return (
    <div style={{
      minHeight: "100vh", width: "100%", display: "flex", alignItems: "center", justifyContent: "center",
      background: "#eef1f5", fontFamily: '"Segoe UI",Tahoma,sans-serif', padding: 20,
    }}>
      <form onSubmit={submit} style={{
        width: "100%", maxWidth: 380, background: "#fff", borderRadius: 12,
        boxShadow: "0 10px 40px rgba(15,23,42,.12), 0 1px 3px rgba(15,23,42,.08)",
        padding: "34px 32px 28px", boxSizing: "border-box", border: "1px solid #e7eaee",
      }}>
        {/* Brand */}
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", marginBottom: 22 }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/resihome-logo.png" alt="ResiHome" style={{ height: 40, objectFit: "contain" }} />
          <div style={{ marginTop: 14, fontSize: 17, fontWeight: 700, color: "#111827" }}>Operations Dashboard</div>
          <div style={{ marginTop: 4, fontSize: 12.5, color: "#6b7280" }}>Sign in to continue</div>
        </div>

        <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: "#374151", marginBottom: 5 }}>Username</label>
        <input
          value={username} onChange={(e) => setUsername(e.target.value)} autoFocus autoComplete="username"
          style={inputStyle}
        />

        <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: "#374151", margin: "14px 0 5px" }}>Password</label>
        <input
          type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password"
          style={inputStyle}
        />

        {err && (
          <div style={{
            marginTop: 14, background: "#fef2f2", border: "1px solid #fecaca", color: "#b91c1c",
            fontSize: 12.5, padding: "8px 10px", borderRadius: 6,
          }}>{err}</div>
        )}

        <button type="submit" disabled={loading} style={{
          marginTop: 20, width: "100%", padding: "11px 0", borderRadius: 7, border: "none",
          background: loading ? "#6b7f74" : "#1a7a4a", color: "#fff", fontSize: 14, fontWeight: 700,
          cursor: loading ? "default" : "pointer", letterSpacing: .2,
        }}>
          {loading ? "Signing in…" : "Sign In"}
        </button>

        <div style={{ marginTop: 18, textAlign: "center", fontSize: 11.5, color: "#9ca3af" }}>
          Access is restricted. Contact your administrator for credentials.
        </div>
      </form>
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  width: "100%", boxSizing: "border-box", padding: "10px 12px", fontSize: 14,
  border: "1px solid #d1d5db", borderRadius: 7, outline: "none", color: "#111827", background: "#fff",
};
