export default function ComingSoon() {
  return (
    <div style={{
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      justifyContent: "center",
      height: "100vh",
      fontFamily: '"Segoe UI", sans-serif',
      color: "#6b7280",
      background: "#f3f4f6",
    }}>
      <div style={{ fontSize: 48, marginBottom: 16 }}>🚧</div>
      <div style={{ fontSize: 20, fontWeight: 700, color: "#374151", marginBottom: 8 }}>
        Coming Soon
      </div>
      <div style={{ fontSize: 13 }}>
        This tab will be built after the Summary tab is approved.
      </div>
    </div>
  );
}
