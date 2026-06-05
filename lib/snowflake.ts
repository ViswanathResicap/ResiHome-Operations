import snowflake from "snowflake-sdk";

// Silence the SDK's verbose logging in serverless.
try { snowflake.configure({ logLevel: "ERROR" }); } catch {}

export function hasSnowflakeEnv(): boolean {
  return Boolean(
    process.env.SNOWFLAKE_ACCOUNT &&
      process.env.SNOWFLAKE_USERNAME &&
      (process.env.SNOWFLAKE_PASSWORD ||
        process.env.SNOWFLAKE_PRIVATE_KEY ||
        process.env.SNOWFLAKE_PRIVATE_KEY_PATH)
  );
}

function readPrivateKey(): string | undefined {
  let pk = process.env.SNOWFLAKE_PRIVATE_KEY;
  if (!pk && process.env.SNOWFLAKE_PRIVATE_KEY_PATH) {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    pk = require("node:fs").readFileSync(process.env.SNOWFLAKE_PRIVATE_KEY_PATH, "utf-8");
  }
  if (!pk) return undefined;
  // Accept base64-encoded keys (Vercel-friendly single-line) or raw PEM.
  if (!pk.includes("BEGIN")) {
    try { pk = Buffer.from(pk, "base64").toString("utf-8"); } catch {}
  }
  return pk.replace(/\\n/g, "\n");
}

export interface Conn {
  query: <T = Record<string, unknown>>(sqlText: string) => Promise<T[]>;
  close: () => void;
}

export async function connect(): Promise<Conn> {
  const cfg: snowflake.ConnectionOptions = {
    account: process.env.SNOWFLAKE_ACCOUNT!,
    username: process.env.SNOWFLAKE_USERNAME!,
    warehouse: process.env.SNOWFLAKE_WAREHOUSE || "DEVELOPER_WH",
    role: process.env.SNOWFLAKE_ROLE || "UAT",
    database: "PROD_ANALYTICS",
    application: "ResiHomeOperations",
  } as snowflake.ConnectionOptions;

  const pk = readPrivateKey();
  if (pk) {
    (cfg as Record<string, unknown>).authenticator = "SNOWFLAKE_JWT";
    (cfg as Record<string, unknown>).privateKey = pk;
    if (process.env.SNOWFLAKE_PRIVATE_KEY_PASSPHRASE)
      (cfg as Record<string, unknown>).privateKeyPass = process.env.SNOWFLAKE_PRIVATE_KEY_PASSPHRASE;
  } else {
    cfg.password = process.env.SNOWFLAKE_PASSWORD!;
  }

  const conn = snowflake.createConnection(cfg);
  await new Promise<void>((res, rej) =>
    conn.connect((err) => (err ? rej(err) : res()))
  );

  return {
    query: (sqlText) =>
      new Promise((res, rej) =>
        conn.execute({
          sqlText,
          complete: (err, _stmt, rows) => (err ? rej(err) : res((rows ?? []) as never)),
        })
      ),
    close: () => conn.destroy(() => {}),
  };
}
