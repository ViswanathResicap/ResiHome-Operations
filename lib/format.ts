export const pct = (v: number, dp = 1) =>
  `${(v * 100).toFixed(dp)}%`;

export const usd = (v: number, dp = 0) =>
  v.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: dp,
    maximumFractionDigits: dp,
  });

export const num = (v: number) => v.toLocaleString("en-US");
