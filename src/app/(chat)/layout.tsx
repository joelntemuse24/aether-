import type { ReactNode } from "react";
import { ChatProviders } from "@/components/chat-providers";

/** Production Aether shell. TrueForge runs behind `/api/chat`, not as a second UI. */
export default function ChatLayout({ children }: { children: ReactNode }) {
  return <ChatProviders>{children}</ChatProviders>;
}
