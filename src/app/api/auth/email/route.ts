import { NextResponse } from "next/server";
import { createMagicLinkToken } from "@/lib/magic-link";

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as { email?: string };
    const email = body.email?.trim().toLowerCase();

    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return NextResponse.json(
        { error: "Enter a valid email address." },
        { status: 400 },
      );
    }

    const token = await createMagicLinkToken(email);
    const origin = new URL(req.url).origin;
    const verifyUrl = `${origin}/auth/verify?token=${encodeURIComponent(token)}`;

    const resendKey = process.env.AUTH_RESEND_KEY || process.env.RESEND_API_KEY;
    const from =
      process.env.AUTH_EMAIL_FROM ||
      process.env.EMAIL_FROM ||
      "Aether <onboarding@resend.dev>";

    if (resendKey) {
      const res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${resendKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from,
          to: [email],
          subject: "Sign in to Aether",
          html: `
            <div style="font-family: system-ui, sans-serif; max-width: 480px; margin: 0 auto;">
              <h2 style="font-weight: 500;">Sign in to Aether</h2>
              <p>Click the button below to sign in. This link expires in 15 minutes.</p>
              <p style="margin: 28px 0;">
                <a href="${verifyUrl}"
                   style="background:#1a1714;color:#fff;padding:12px 20px;border-radius:8px;text-decoration:none;display:inline-block;">
                  Continue to Aether
                </a>
              </p>
              <p style="color:#666;font-size:13px;">If you didn’t request this, you can ignore this email.</p>
            </div>
          `,
        }),
      });

      if (!res.ok) {
        const errText = await res.text().catch(() => "");
        console.error("[auth/email] Resend failed", res.status, errText);
        return NextResponse.json(
          { error: "Could not send email. Check AUTH_RESEND_KEY / AUTH_EMAIL_FROM." },
          { status: 502 },
        );
      }

      return NextResponse.json({ ok: true });
    }

    // Dev fallback when Resend is not configured — return the link
    if (process.env.NODE_ENV !== "production") {
      console.info("[auth/email] Dev magic link:", verifyUrl);
      return NextResponse.json({
        ok: true,
        devLink: verifyUrl,
        message:
          "AUTH_RESEND_KEY not set — magic link returned for local development.",
      });
    }

    return NextResponse.json(
      {
        error:
          "Email sign-in is not configured. Set AUTH_RESEND_KEY (and optionally AUTH_EMAIL_FROM).",
      },
      { status: 503 },
    );
  } catch (err) {
    console.error("[auth/email]", err);
    return NextResponse.json(
      { error: "Failed to send magic link." },
      { status: 500 },
    );
  }
}
