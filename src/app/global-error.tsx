"use client";

/**
 * Last-resort boundary when the root layout itself crashes.
 * Must render its own <html>/<body>; global styles may not be loaded,
 * so styling is inline.
 */
export default function GlobalError({
  error,
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
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: 16,
          background: "#faf7f1",
          color: "#1a1714",
          fontFamily: "system-ui, sans-serif",
          textAlign: "center",
          padding: 24,
        }}
      >
        <h1 style={{ fontSize: 22, fontWeight: 500, margin: 0 }}>
          Aether hit an unexpected error
        </h1>
        <p style={{ maxWidth: 420, fontSize: 14, color: "#6b6458", margin: 0 }}>
          Reloading usually fixes this. Your conversations are stored safely.
          {error.digest ? ` (ref: ${error.digest})` : ""}
        </p>
        <button
          type="button"
          onClick={() => reset()}
          style={{
            border: "none",
            borderRadius: 8,
            background: "#d4734f",
            color: "#fff",
            padding: "10px 18px",
            fontSize: 14,
            cursor: "pointer",
          }}
        >
          Reload
        </button>
      </body>
    </html>
  );
}
