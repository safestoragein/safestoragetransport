// Microsoft Graph client for the shared retrieval@ / damages@ mailboxes.
//
// Basic IMAP passwords no longer work on Exchange Online (verified: the server answers
// "AUTHENTICATE failed"), so we use an Entra app registration with application permissions and the
// client-credentials flow. No mailbox password is stored anywhere, and access is revocable in the
// Azure portal.
//
// Env (server .env): MS_TENANT_ID, MS_CLIENT_ID, MS_CLIENT_SECRET.
const TENANT = process.env.MS_TENANT_ID ?? "";
const CLIENT_ID = process.env.MS_CLIENT_ID ?? "";
const CLIENT_SECRET = process.env.MS_CLIENT_SECRET ?? "";

export const graphConfigured = Boolean(TENANT && CLIENT_ID && CLIENT_SECRET);

/* eslint-disable @typescript-eslint/no-explicit-any */

let cached: { token: string; expires: number } | null = null;

export async function graphToken(): Promise<string> {
  if (!graphConfigured) throw new Error("Microsoft Graph is not configured (set MS_TENANT_ID / MS_CLIENT_ID / MS_CLIENT_SECRET)");
  if (cached && Date.now() < cached.expires) return cached.token;
  const res = await fetch(`https://login.microsoftonline.com/${TENANT}/oauth2/v2.0/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      scope: "https://graph.microsoft.com/.default",
      grant_type: "client_credentials",
    }).toString(),
    cache: "no-store",
  });
  const j: any = await res.json();
  if (!j.access_token) throw new Error(`Graph token failed: ${j.error ?? res.status} ${String(j.error_description ?? "").slice(0, 160)}`);
  // Refresh a minute early so a long sync can't run past the expiry.
  cached = { token: j.access_token, expires: Date.now() + (Number(j.expires_in ?? 3600) - 60) * 1000 };
  return cached.token;
}

export interface GraphMessage {
  id: string;
  internetMessageId: string;
  conversationId: string;
  subject: string;
  bodyPreview: string;
  body?: { contentType: string; content: string };
  from?: { emailAddress?: { name?: string; address?: string } };
  toRecipients?: { emailAddress?: { address?: string } }[];
  ccRecipients?: { emailAddress?: { address?: string } }[];
  receivedDateTime: string;
  hasAttachments: boolean;
}

// Inbox messages newer than `sinceIso`, oldest first so a thread is built in order.
export async function fetchInbox(mailbox: string, sinceIso: string, max = 400): Promise<GraphMessage[]> {
  const token = await graphToken();
  const select = "id,internetMessageId,conversationId,subject,bodyPreview,body,from,toRecipients,ccRecipients,receivedDateTime,hasAttachments";
  let url = `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(mailbox)}/mailFolders/inbox/messages`
    + `?$select=${select}&$top=100&$orderby=receivedDateTime asc`
    + `&$filter=receivedDateTime ge ${sinceIso}`;
  const out: GraphMessage[] = [];
  while (url && out.length < max) {
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}`, Prefer: 'outlook.body-content-type="text"' }, cache: "no-store" });
    const j: any = await res.json();
    if (j.error) throw new Error(`Graph ${mailbox}: ${j.error.code} ${String(j.error.message).slice(0, 160)}`);
    out.push(...(j.value ?? []));
    url = j["@odata.nextLink"] ?? "";
  }
  return out.slice(0, max);
}
/* eslint-enable @typescript-eslint/no-explicit-any */
