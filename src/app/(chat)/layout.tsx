import type { ReactNode } from "react";
import { ChatProviders } from "@/components/chat-providers";

export default function ChatLayout({ children }: { children: ReactNode }) {
  return <ChatProviders>{children}</ChatProviders>;
}
