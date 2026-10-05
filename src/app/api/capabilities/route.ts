import { NextResponse } from "next/server";
import { isDesignConnected } from "@/lib/connectors/design";
import { isDeploymentsConnected } from "@/lib/connectors/deployments";
import { optionalMcpStatus } from "@/lib/mcp/optional";
import { isCloudDbConfigured } from "@/lib/db";
import { trueforgeSandboxEnabled } from "@/lib/trueforge/config";
import { trueforgeSchedulesAvailable } from "@/lib/trueforge/schedules";

export const runtime = "nodejs";

export async function GET() {
  const mcp = optionalMcpStatus();
  const [schedulesAvailable, codeModeAvailable] = await Promise.all([
    trueforgeSchedulesAvailable(),
    trueforgeSandboxEnabled(),
  ]);
  return NextResponse.json({
    playback: "browser",
    schedules: {
      configured: schedulesAvailable,
      cloud: isCloudDbConfigured(),
      backend: schedulesAvailable ? "harness" : "unavailable",
    },
    codeMode: { available: codeModeAvailable },
    design: { connected: isDesignConnected() },
    deployments: { connected: isDeploymentsConnected() },
    social: { connected: false },
    mcp: { enabled: mcp.enabled, available: mcp.available },
  });
}
