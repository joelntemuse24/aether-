import NextAuth from "next-auth";
import Google from "next-auth/providers/google";
import GitHub from "next-auth/providers/github";
import Apple from "next-auth/providers/apple";
import Credentials from "next-auth/providers/credentials";
import type { Provider } from "next-auth/providers";
import { verifyMagicLinkToken } from "@/lib/magic-link";
import { clearDriveCookie } from "@/lib/drive-session";

const googleId = process.env.GOOGLE_CLIENT_ID || process.env.AUTH_GOOGLE_ID;
const googleSecret =
  process.env.GOOGLE_CLIENT_SECRET || process.env.AUTH_GOOGLE_SECRET;
const githubId = process.env.GITHUB_CLIENT_ID || process.env.AUTH_GITHUB_ID;
const githubSecret =
  process.env.GITHUB_CLIENT_SECRET || process.env.AUTH_GITHUB_SECRET;
const appleId = process.env.APPLE_ID || process.env.AUTH_APPLE_ID;
const appleSecret = process.env.APPLE_SECRET || process.env.AUTH_APPLE_SECRET;

const providers: Provider[] = [];

if (googleId && googleSecret) {
  providers.push(
    Google({
      clientId: googleId,
      clientSecret: googleSecret,
      allowDangerousEmailAccountLinking: true,
    }),
  );
}

if (githubId && githubSecret) {
  providers.push(
    GitHub({
      clientId: githubId,
      clientSecret: githubSecret,
      allowDangerousEmailAccountLinking: true,
    }),
  );
}

/**
 * Sign in with Apple requires an Apple Developer Program membership,
 * a Services ID, and a client secret JWT (APPLE_ID + APPLE_SECRET).
 * Provider is only registered when those env vars are present.
 */
if (appleId && appleSecret) {
  providers.push(
    Apple({
      clientId: appleId,
      clientSecret: appleSecret,
      allowDangerousEmailAccountLinking: true,
    }),
  );
}

// Magic-link email via Credentials + signed JWT (no database required)
providers.push(
  Credentials({
    id: "email-magic",
    name: "Email",
    credentials: {
      token: { label: "Token", type: "text" },
    },
    async authorize(credentials) {
      const token = credentials?.token;
      if (typeof token !== "string" || !token) return null;
      const verified = await verifyMagicLinkToken(token);
      if (!verified) return null;
      return {
        id: verified.email,
        email: verified.email,
        name: verified.email.split("@")[0],
      };
    },
  }),
);

export const { handlers, auth, signIn, signOut } = NextAuth({
  providers,
  // Placeholder allows `next build` without secrets; set AUTH_SECRET in deploy.
  secret: process.env.AUTH_SECRET || "aether-dev-secret-change-me",
  session: {
    strategy: "jwt",
    maxAge: 30 * 24 * 60 * 60,
  },
  pages: {
    signIn: "/auth/signin",
    error: "/auth/signin",
  },
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.id = user.id ?? user.email ?? undefined;
        token.email = user.email;
        token.name = user.name;
        token.picture = user.image;
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        if (typeof token.id === "string") {
          session.user.id = token.id;
        } else if (typeof token.email === "string") {
          session.user.id = token.email;
        }
        if (typeof token.email === "string") {
          session.user.email = token.email;
        }
        if (typeof token.name === "string") {
          session.user.name = token.name;
        }
        if (typeof token.picture === "string") {
          session.user.image = token.picture;
        }
      }
      return session;
    },
  },
  events: {
    async signOut() {
      try {
        await clearDriveCookie();
      } catch {
        // ignore outside request context
      }
    },
  },
  trustHost: true,
});
