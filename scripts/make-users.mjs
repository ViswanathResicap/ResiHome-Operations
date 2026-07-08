// Admin helper: turn a list of "username=password" pairs into the base64
// APP_USERS value to paste into .env.local (local) and Vercel (Settings →
// Environment Variables). Passwords are bcrypt-hashed; plain text is never
// stored. Base64 keeps the "$" in hashes safe from env variable-expansion.
//
// Usage:
//   node scripts/make-users.mjs "alice=Str0ngPass!" "bob=An0therPass!"
//
// Then set:  APP_USERS=<the printed base64 string>
import bcrypt from "bcryptjs";

const pairs = process.argv.slice(2);
if (pairs.length === 0) {
  console.error('Usage: node scripts/make-users.mjs "user1=password1" "user2=password2" ...');
  process.exit(1);
}

const users = pairs.map((p) => {
  const i = p.indexOf("=");
  if (i < 0) { console.error(`Bad pair (missing "="): ${p}`); process.exit(1); }
  const u = p.slice(0, i).trim();
  const pw = p.slice(i + 1);
  if (!u || !pw) { console.error(`Bad pair: ${p}`); process.exit(1); }
  return { u, h: bcrypt.hashSync(pw, 10) };
});

const b64 = Buffer.from(JSON.stringify(users), "utf8").toString("base64");
console.log(`\n${users.length} user(s): ${users.map((x) => x.u).join(", ")}`);
console.log("\nAPP_USERS=");
console.log(b64);
console.log("\nPaste the line above into .env.local and into Vercel → Settings → Environment Variables (Production + Preview), then redeploy.\n");
