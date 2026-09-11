import { NextResponse } from "next/server";
import { isDesignConnected } from "@/lib/connectors/design";
import { isDeploymentsConnected } from "@/lib/connectors/deployments";
import { optionalMcpStatus } from "@/lib/mcp/optional";
import { isTriggerChatConfigured } from "@/lib/trigger/config";
import { isCloudDbConfigured } from "@/lib/db";

export const runtime = "nodejs";

export async function GET() {
  const mcp = optionalMcpStatus();
  return NextResponse.json({
    playback: "browser",
    schedules: {
      configured: isTriggerChatConfigured(),
      cloud: isCloudDbConfigured(),
    },
    design: { connected: isDesignConnected() },
    deployments: { connected: isDeploymentsConnected() },
    social: { connected: false },
    mcp: { enabled: mcp.enabled, available: mcp.available },
  });
}
