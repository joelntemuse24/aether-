/**
 * Google Workspace connector: Gmail, Calendar, Contacts.
 * Uses the existing Drive OAuth grant — same account, same token refresh.
 * The current cookie grant is drive.readonly; Gmail/Calendar/Contacts scopes
 * are requested via incremental OAuth and surfaced as separate capabilities.
 */

const GMAIL_API = "https://gmail.googleapis.com/gmail/v1/users/me";
const CALENDAR_API = "https://www.googleapis.com/calendar/v3";
const PEOPLE_API = "https://people.googleapis.com/v1";

import { getValidDriveAccessToken } from "@/lib/drive-session";

export const GOOGLE_SCOPES = {
  driveRead: "https://www.googleapis.com/auth/drive.readonly",
  driveWrite: "https://www.googleapis.com/auth/drive",
  gmailRead: "https://www.googleapis.com/auth/gmail.readonly",
  gmailCompose: "https://www.googleapis.com/auth/gmail.compose",
  gmailSend: "https://www.googleapis.com/auth/gmail.send",
  calendar: "https://www.googleapis.com/auth/calendar.events",
  contactsRead: "https://www.googleapis.com/auth/contacts.readonly",
  contactsWrite: "https://www.googleapis.com/auth/contacts",
} as const;

async function googleToken(userId: string, accessToken?: string) {
  if (accessToken) return accessToken;
  return (await getValidDriveAccessToken(userId)) ?? undefined;
}

async function googleFetch(
  userId: string,
  url: string,
  init: RequestInit,
  accessToken?: string,
): Promise<{ ok: true; data: unknown } | { ok: false; error: string }> {
  const token = await googleToken(userId, accessToken);
  if (!token) return { ok: false, error: "Google is not connected." };
  const res = await fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(init?.headers ?? {}),
    },
  });
  if (res.status === 401) {
    return { ok: false, error: "Google authorization expired. Reconnect Google in Preferences." };
  }
  const text = await res.text();
  if (!res.ok) {
    return { ok: false, error: `Google API failed (${res.status})` };
  }
  try {
    return { ok: true, data: JSON.parse(text) as unknown };
  } catch {
    return { ok: false, error: "Google API returned invalid JSON." };
  }
}

// ─── Gmail ───

export async function gmailSearchForUser(
  userId: string,
  query: string,
  maxResults = 15,
  accessToken?: string,
): Promise<{
  ok: boolean;
  error?: string;
  messages?: Array<{
    id: string;
    threadId: string;
    subject: string;
    from: string;
    date: string;
    snippet: string;
  }>;
}> {
  const list = await googleFetch(
    userId,
    `${GMAIL_API}/users/me/messages?q=${encodeURIComponent(query)}&maxResults=${maxResults}`,
    { method: "GET" },
    accessToken,
  );
  if (!list.ok) return { ok: false, error: list.error };
  const ids = (list.data as { messages?: Array<{ id: string; threadId: string }> })
    .messages ?? [];
  const messages: NonNullable<    Awaited<ReturnType<typeof gmailSearchForUser>>["messages"]
  > = [];
  for (const item of ids.slice(0, maxResults)) {
    const full = await googleFetch(
      userId,
      `${GMAIL_API}/users/me/messages/${item.id}?format=metadata&metadataHeaders=Subject&metadataHeaders=From&metadataHeaders=Date`,
      { method: "GET" },
      accessToken,
    );
    if (!full.ok) continue;
    const data = full.data as {
      snippet?: string;
      payload?: { headers?: Array<{ name: string; value: string }> };
    };
    const header = (name: string) =>
      data.payload?.headers?.find((h) => h.name === name)?.value ?? "";
    messages.push({
      id: item.id,
      threadId: item.threadId,
      subject: header("Subject") || "(no subject)",
      from: header("From"),
      date: header("Date"),
      snippet: data.snippet ?? "",
    });
  }
  return { ok: true, messages };
}

export async function gmailReadForUser(
  userId: string,
  messageId: string,
  accessToken?: string,
): Promise<{
  ok: boolean;
  error?: string;
  subject?: string;
  from?: string;
  to?: string;
  date?: string;
  body?: string;
  threadId?: string;
}> {
  const full = await googleFetch(
    userId,
    `${GMAIL_API}/users/me/messages/${encodeURIComponent(messageId)}?format=full`,
    { method: "GET" },
    accessToken,
  );
  if (!full.ok) return { ok: false, error: full.error };
  const data = full.data as {
    threadId?: string;
    snippet?: string;
    payload?: {
      headers?: Array<{ name: string; value: string }>;
      mimeType?: string;
      body?: { data?: string };
      parts?: Array<{
        mimeType?: string;
        body?: { data?: string };
        parts?: Array<{ mimeType?: string; body?: { data?: string } }>;
      }>;
    };
  };
  const header = (name: string) =>
    data.payload?.headers?.find((h) => h.name === name)?.value ?? "";
  let body = "";
  const parts = data.payload?.parts ?? [];
  const plain = parts.find((p) => p.mimeType === "text/plain");
  const html = parts.find((p) => p.mimeType === "text/html");
  const chosen = plain?.body?.data ?? html?.body?.data ?? data.payload?.body?.data;
  if (chosen) {
    body = Buffer.from(chosen.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");
  }
  return {
    ok: true,
    subject: header("Subject"),
    from: header("From"),
    to: header("To"),
    date: header("Date"),
    body: body.slice(0, 50_000) || data.snippet || "",
    threadId: data.threadId,
  };
}

function base64UrlEncode(input: string): string {
  return Buffer.from(input, "utf8")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

export async function gmailSendForUser(
  userId: string,
  input: { to: string; subject: string; body: string; threadId?: string },
  accessToken?: string,
): Promise<{ ok: boolean; error?: string; messageId?: string; threadId?: string }> {
  const mime = [
    `To: ${input.to}`,
    "Content-Type: text/plain; charset=UTF-8",
    `Subject: ${input.subject ?? input.subject}`,
    "",
    input.body,
  ].join("\r\n");
  const send = await googleFetch(
    userId,
    `${GMAIL_API}/users/me/messages/send`,
    {
      method: "POST",
      body: JSON.stringify({
        raw: base64UrlEncode(mime),
        ...(input.threadId ? { threadId: input.threadId } : {}),
      }),
    },
    accessToken,
  );
  if (!send.ok) return { ok: false, error: send.error };
  const data = send.data as { id?: string; threadId?: string };
  return { ok: true, messageId: data.id, threadId: data.threadId };
}

export async function gmailCreateDraftForUser(
  userId: string,
  input: { to: string; subject: string; body: string; threadId?: string },
  accessToken?: string,
): Promise<{ ok: boolean; error?: string; draftId?: string }> {
  const mime = [
    `To: ${input.to}`,
    "Content-Type: text/plain; charset=UTF-8",
    `Subject: ${input.subject}`,
    "",
    input.body,
  ].join("\r\n");
  const draft = await googleFetch(
    userId,
    `${GMAIL_API}/users/me/drafts`,
    {
      method: "POST",
      body: JSON.stringify({
        message: {
          raw: base64UrlEncode(mime),
          ...(input.threadId ? { threadId: input.threadId } : {}),
        },
      }),
    },
    accessToken,
  );
  if (!draft.ok) return { ok: false, error: draft.error };
  const data = draft.data as { id?: string };
  return { ok: true, draftId: data.id };
}

// ─── Calendar ───

export async function calendarListEventsForUser(
  userId: string,
  input: { timeMin?: string; timeMax?: string; query?: string; maxResults?: number },
  accessToken?: string,
): Promise<{
  ok: boolean;
  error?: string;
  events?: Array<{
    id: string;
    summary: string;
    start?: string;
    end?: string;
    location?: string;
    attendees?: number;
  }>;
}> {
  const params = new URLSearchParams({
    timeMin: input.timeMin ?? new Date().toISOString(),
    singleEvents: "true",
    orderBy: "startTime",
    maxResults: String(input.maxResults ?? 15),
  });
  const res = await googleFetch(
    userId,
    `${CALENDAR_API}/calendars/primary/events?${params.toString()}`,
    { method: "GET" },
    accessToken,
  );
  if (!res.ok) return { ok: false, error: res.error };
  const data = res.data as {
    items?: Array<{
      id: string;
      summary?: string;
      start?: { dateTime?: string; date?: string };
      end?: { dateTime?: string; date?: string };
      location?: string;
      attendees?: unknown[];
    }>;
  };
  return {
    ok: true,
    events: (data.items ?? []).slice(0, input.maxResults ?? 15).map((event) => ({
      id: event.id,
      summary: event.summary ?? "(untitled)",
      start: event.start?.dateTime ?? event.start?.date,
      end: event.end?.dateTime ?? event.end?.date,
      location: event.location,
      attendees: event.attendees?.length,
    })),
  };
}

export async function calendarCreateEventForUser(
  userId: string,
  input: {
    summary: string;
    start: string;
    end: string;
    description?: string;
    location?: string;
    attendees?: string[];
    timeZone?: string;
  },
  accessToken?: string,
): Promise<{ ok: boolean; error?: string; eventId?: string; url?: string }> {
  const res = await googleFetch(
    userId,
    `${CALENDAR_API}/calendars/primary/events`,
    {
      method: "POST",
      body: JSON.stringify({
        summary: input.summary,
        start: { dateTime: input.start, timeZone: input.timeZone },
        end: { dateTime: input.end, timeZone: input.timeZone },
        ...(input.description ? { description: input.description } : {}),
        ...(input.location ? { location: input.location } : {}),
        ...(input.attendees?.length
          ? { attendees: input.attendees.map((email) => ({ email })) }
          : {}),
      }),
    },
    accessToken,
  );
  if (!res.ok) return { ok: false, error: res.error };
  const data = res.data as { id?: string; htmlLink?: string };
  return { ok: true, eventId: data.id, url: data.htmlLink };
}

export async function calendarDeleteEventForUser(
  userId: string,
  eventId: string,
  accessToken?: string,
): Promise<{ ok: boolean; error?: string }> {
  const token = await googleToken(userId, accessToken);
  if (!token) return { ok: false, error: "Google is not connected." };
  const res = await fetch(
    `${CALENDAR_API}/calendars/primary/events/${encodeURIComponent(eventId)}`,
    {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` },
    },
  );
  if (res.status === 401) {
    return { ok: false, error: "Google authorization expired. Reconnect Google in Preferences." };
  }
  if (!res.ok && res.status !== 404) {
    return { ok: false, error: `Calendar delete failed (${res.status})` };
  }
  return { ok: true };
}

// ─── Contacts ───

export async function contactsSearchForUser(
  userId: string,
  query: string,
  accessToken?: string,
): Promise<{
  ok: boolean;
  error?: string;
  contacts?: Array<{
    name: string;
    emails: string[];
    phones: string[];
  }>;
}> {
  const params = new URLSearchParams({
    query,
    pageSize: "15",
    personFields: "names,emailAddresses,phoneNumbers",
  });
  const res = await googleFetch(
    userId,
    `${PEOPLE_API}/people:searchContacts?${params.toString()}`,
    { method: "GET" },
    accessToken,
  );
  if (!res.ok) return { ok: false, error: res.error };
  const data = res.data as {
    results?: Array<{
      person?: {
        names?: Array<{ displayName?: string }>;
        emailAddresses?: Array<{ value?: string }>;
        phoneNumbers?: Array<{ value?: string }>;
      };
    }>;
  };
  return {
    ok: true,
    contacts: (data.results ?? [])
      .map((entry) => ({
        name: entry.person?.names?.[0]?.displayName ?? "",
        emails: (entry.person?.emailAddresses ?? [])
          .map((e) => e.value ?? "")
          .filter(Boolean),
        phones: (entry.person?.phoneNumbers ?? [])
          .map((p) => p.value ?? "")
          .filter(Boolean),
      })),
  };
}

export async function contactsCreateForUser(
  userId: string,
  input: {
    firstName?: string;
    lastName?: string;
    emails?: string[];
    phones?: string[];
  },
  accessToken?: string,
): Promise<{ ok: boolean; error?: string; resourceName?: string }> {
  const res = await googleFetch(
    userId,
    `${PEOPLE_API}/people:createContact`,
    {
      method: "POST",
      body: JSON.stringify({
        names: [{ givenName: input.firstName, familyName: input.lastName }],
        emailAddresses: (input.emails ?? []).map((value) => ({ value })),
        phoneNumbers: (input.phones ?? []).map((value) => ({ value })),
      }),
    },
    accessToken,
  );
  if (!res.ok) return { ok: false, error: res.error };
  const data = res.data as { resourceName?: string };
  return { ok: true, resourceName: data.resourceName };
}
