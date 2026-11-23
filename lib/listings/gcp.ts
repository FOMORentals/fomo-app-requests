/**
 * Google Cloud access for website listings: the board's Firestore (fomo-bookings-board-v2: the shared Rentman circuit
 * and call counter, the Rentman writer lease, listing drafts, the website's search index) and the website-sync Cloud
 * Run job ("go live now").
 *
 * Credentials: one service account key in FIREBASE_SERVICE_ACCOUNT_BASE64 (Vercel, Sensitive), as the consignor portal.
 * @fomo/rentman-core's guard opens Firestore with Application Default Credentials, so the key is also written once to
 * a temp file named by GOOGLE_APPLICATION_CREDENTIALS before anything from it is imported. Never logged.
 */
import { writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { Firestore } from "@google-cloud/firestore";
import { GoogleAuth } from "google-auth-library";

export const BOARD_PROJECT = "fomo-bookings-board-v2";

type Key = { client_email: string; private_key: string };
let key: Key | null = null;

function serviceAccount(): Key {
  if (key) return key;
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT_BASE64?.trim();
  if (!raw) throw new Error("FIREBASE_SERVICE_ACCOUNT_BASE64 is not set");
  let parsed: Key;
  try {
    parsed = JSON.parse(Buffer.from(raw, "base64").toString("utf8"));
  } catch {
    throw new Error("FIREBASE_SERVICE_ACCOUNT_BASE64 isn't a base64 service account key");
  }
  if (!parsed.client_email || !parsed.private_key) throw new Error("FIREBASE_SERVICE_ACCOUNT_BASE64 is missing client_email or private_key");
  key = parsed;
  return key;
}

/** Makes the key visible to libraries that use Application Default Credentials (the Rentman guard). Idempotent. */
export function ensureAdc(): void {
  if (process.env.GOOGLE_APPLICATION_CREDENTIALS) return;
  const k = serviceAccount();
  const file = path.join(tmpdir(), "fomo-app-requests-sa.json");
  writeFileSync(file, JSON.stringify({ type: "service_account", ...k }), { mode: 0o600 });
  process.env.GOOGLE_APPLICATION_CREDENTIALS = file;
}

let firestore: Firestore | null = null;

export function db(): Firestore {
  if (!firestore) {
    const k = serviceAccount();
    firestore = new Firestore({ projectId: BOARD_PROJECT, credentials: { client_email: k.client_email, private_key: k.private_key } });
  }
  return firestore;
}

/** An access token for Google APIs (Cloud Run), from the same service account. */
export async function googleToken(): Promise<string> {
  const k = serviceAccount();
  const auth = new GoogleAuth({ credentials: { client_email: k.client_email, private_key: k.private_key }, scopes: ["https://www.googleapis.com/auth/cloud-platform"] });
  const t = await (await auth.getClient()).getAccessToken();
  if (!t.token) throw new Error("Google gave no access token for the service account");
  return t.token;
}
