import fs from "node:fs";
import path from "node:path";

const GET_TOOLS = `  getTools() {
    return this.tools;
  }`;

const GET_TOOLS_PATCHED = `  getTools() {
    if (![...this.serverMap.values()].some((server) => !server.preload)) return [];
    return this.tools;
  }`;

const SKILLS_AND_MCP = `  buildSkillsSection(builder) {
    builder.addContent(this.renderSkillsSection());
  }
  buildMCPSection(builder) {
    const toolSetNames = this.codeExecToolSets.map((m) => m.name).join(",");
    if (!toolSetNames) {
      return;
    }
    builder.addSection(`;

const SKILLS_AND_MCP_PATCHED = `  buildSkillsSection(builder) {
    const skills = this.renderSkillsSection();
    if (skills.includes("SKILL.md")) builder.addContent(skills);
  }
  buildMCPSection(builder) {
    const toolSetNames = this.codeExecToolSets.map((m) => m.name).join(",");
    if (!toolSetNames) {
      return;
    }
    builder.addSection(
      SANDBOX_MCP_REMINDER_TAG,
      \`exec can reach these MCP servers: \${toolSetNames}. Call tools directly unless the task needs code.\`
    );
    return;
    builder.addSection(`;

const SCHEMA = `  buildSchemaSection(builder) {
    builder.addSection(`;

const SCHEMA_PATCHED = `  buildSchemaSection(builder) {
    return;
    builder.addSection(`;

const FILE_OUTPUT = `        ## File outputs

        The user does not have direct access to the sandbox filesystem. When the Agent wants to output a file to the user, it MUST:
        1. Ensure that the file is present in the sandbox.
        2. Then emit a fenced sandbox_artifacts block referencing the file.`;

const FILE_OUTPUT_LEAK = `        To give the user a file, write it in the sandbox and emit a sandbox_artifacts block: [label](/absolute/path). One link per line.`;

const FILE_OUTPUT_PATCHED = `        To give the user a file, write it in the sandbox and emit one fenced sandbox_artifacts block. One markdown link per line: [label](/absolute/path). Do not repeat those paths in the answer.`;

function patchClock(source: string): { text: string; changed: boolean } {
  if (source.includes(CLOCK_OFF) && !source.includes("currentDateTime({ tracing })") && !source.includes("import_CurrentDateTime.currentDateTime")) {
    return { text: source, changed: false };
  }
  let text = source;
  let changed = false;
  if (text.includes(CLOCK_JS)) {
    text = text.replace(CLOCK_JS, CLOCK_OFF);
    changed = true;
  }
  if (text.includes(CLOCK_MJS)) {
    text = text.replace(CLOCK_MJS, CLOCK_OFF);
    changed = true;
  }
  return { text, changed };
}

function patchText(source: string, kind: "deferred" | "sandbox"): { text: string; changed: boolean } {
  let text = source;
  let changed = false;
  if (kind === "deferred") {
    if (text.includes(GET_TOOLS) && !text.includes("!server.preload")) {
      text = text.replace(GET_TOOLS, GET_TOOLS_PATCHED);
      changed = true;
    }
    return { text, changed };
  }
  if (text.includes(GET_TOOLS_PATCHED)) {
    text = text.replaceAll(GET_TOOLS_PATCHED, GET_TOOLS);
    changed = true;
  }
  if (text.includes(SKILLS_AND_MCP) && !text.includes("exec can reach these MCP servers")) {
    text = text.replace(SKILLS_AND_MCP, SKILLS_AND_MCP_PATCHED);
    changed = true;
  }
  if (text.includes(SCHEMA) && !text.includes("buildSchemaSection(builder) {\n    return;")) {
    text = text.replace(SCHEMA, SCHEMA_PATCHED);
    changed = true;
  }
  if (text.includes(FILE_OUTPUT)) {
    text = text.replace(FILE_OUTPUT, FILE_OUTPUT_PATCHED);
    changed = true;
  } else if (text.includes(FILE_OUTPUT_LEAK)) {
    text = text.replace(FILE_OUTPUT_LEAK, FILE_OUTPUT_PATCHED);
    changed = true;
  }
  return { text, changed };
}

const CLOCK_JS = "const capabilities = [(0, import_CurrentDateTime.currentDateTime)({ tracing })];";
const CLOCK_MJS = "const capabilities = [currentDateTime({ tracing })];";
const CLOCK_OFF = "const capabilities = [];";

const EXEC_TIMEOUT_FROM = "var DEFAULT_TIMEOUT_SECONDS = 60;";
const EXEC_TIMEOUT_TO = "var DEFAULT_TIMEOUT_SECONDS = 45;";

/** The VM installs pandas, numpy, openpyxl, and python-pptx system-wide. The sandbox venv must see them. */
const VENV_FROM = '["-m", "venv", venvDir]';
const VENV_TO = '["-m", "venv", "--system-site-packages", venvDir]';

/** pandas imports pytz, which reads the tz database. The jail must see /usr/share/zoneinfo. */
const ZONEINFO_FROM = `        "/proc",
        "/sys",
        SRT_VENDOR`;
const ZONEINFO_TO = `        "/proc",
        "/sys",
        "/usr/share/zoneinfo",
        SRT_VENDOR`;

const RELATIVE_FILES = [
  "node_modules/@truefoundry/trueforge-core/dist/core/runtime/DeferredTool.js",
  "node_modules/@truefoundry/trueforge-core/dist/core/runtime/DeferredTool.mjs",
  "node_modules/@truefoundry/trueforge-core/dist/core/sandbox/Sandbox.js",
  "node_modules/@truefoundry/trueforge-core/dist/core/sandbox/Sandbox.mjs",
  "node_modules/@truefoundry/trueforge-core/dist/core/sandbox/provider/TFYSandboxProvider.js",
  "node_modules/@truefoundry/trueforge-core/dist/core/sandbox/provider/TFYSandboxProvider.mjs",
  "node_modules/@truefoundry/trueforge-core/dist/agent-session/builtinsFromSpec.js",
  "node_modules/@truefoundry/trueforge-core/dist/agent-session/builtinsFromSpec.mjs",
  "node_modules/@truefoundry/trueforge/dist/main.js",
];

function patchExecTimeout(source: string): { text: string; changed: boolean } {
  if (source.includes(EXEC_TIMEOUT_TO)) return { text: source, changed: false };
  if (!source.includes(EXEC_TIMEOUT_FROM)) return { text: source, changed: false };
  return { text: source.replace(EXEC_TIMEOUT_FROM, EXEC_TIMEOUT_TO), changed: true };
}

function patchVenv(source: string): { text: string; changed: boolean } {
  if (source.includes(VENV_TO)) return { text: source, changed: false };
  if (!source.includes(VENV_FROM)) return { text: source, changed: false };
  return { text: source.replace(VENV_FROM, VENV_TO), changed: true };
}

function patchZoneinfo(source: string): { text: string; changed: boolean } {
  if (source.includes(ZONEINFO_TO)) return { text: source, changed: false };
  if (!source.includes(ZONEINFO_FROM)) return { text: source, changed: false };
  return { text: source.replace(ZONEINFO_FROM, ZONEINFO_TO), changed: true };
}

/** main.js carries the venv flag and the linux jail read list. */
function patchMain(source: string): { text: string; changed: boolean } {
  const venv = patchVenv(source);
  const zoneinfo = patchZoneinfo(venv.text);
  return { text: zoneinfo.text, changed: venv.changed || zoneinfo.changed };
}

function alreadyPatched(
  source: string,
  kind: "deferred" | "sandbox" | "clock" | "exec-timeout" | "venv",
): boolean {
  if (kind === "deferred") return source.includes("!server.preload");
  if (kind === "clock") return source.includes(CLOCK_OFF);
  if (kind === "exec-timeout") return source.includes(EXEC_TIMEOUT_TO);
  if (kind === "venv") return source.includes(VENV_TO) && source.includes(ZONEINFO_TO);
  return (
    source.includes("exec can reach these MCP servers") &&
    source.includes("buildSchemaSection(builder) {\n    return;")
  );
}

/** Patch the installed sidecar package. Missing files are skipped. A file that is present but does not contain the expected text is warned. */
export function applyTrueForgeSidecarPatches(root = process.cwd()): string[] {
  const patched: string[] = [];
  for (const relative of RELATIVE_FILES) {
    const file = path.join(root, relative);
    if (!fs.existsSync(file)) continue;
    const source = fs.readFileSync(file, "utf8");
    const kind = relative.includes("DeferredTool")
      ? "deferred"
      : relative.includes("builtinsFromSpec")
        ? "clock"
        : relative.includes("TFYSandboxProvider")
          ? "exec-timeout"
          : relative.includes("trueforge/dist/main")
            ? "venv"
            : "sandbox";
    const next =
      kind === "clock"
        ? patchClock(source)
        : kind === "exec-timeout"
          ? patchExecTimeout(source)
          : kind === "venv"
            ? patchMain(source)
            : patchText(source, kind);
    if (next.changed) {
      fs.writeFileSync(file, next.text);
      patched.push(relative);
      continue;
    }
    if (!alreadyPatched(source, kind)) {
      console.warn(`[trueforge] sidecar patch skipped ${relative}: expected text was not found`);
    }
  }
  return patched;
}
