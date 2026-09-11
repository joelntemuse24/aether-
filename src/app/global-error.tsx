"use client";

export default function GlobalError({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#faf7f1",
          color: "#1a1714",
          fontFamily:
            "ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, sans-serif",
        }}
      >
        <div style={{ padding: 24, textAlign: "center", maxWidth: 360 }}>
          <p style={{ lineHeight: 1.6, fontSize: 16 }}>
            Couldn’t load this chat. Your history is still here — try again.
          </p>
          <button
            type="button"
            onClick={() => reset()}
            style={{
              marginTop: 16,
              border: 0,
              borderRadius: 999,
              background: "#d4734f",
              color: "#fff",
              padding: "8px 16px",
              fontSize: 13,
            }}
          >
            Try again
          </button>
        </div>
      </body>
    </html>
  );
}
