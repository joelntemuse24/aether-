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

const FILE_OUTPUT_PATCHED = `        To give the user a file, write it in the sandbox and emit a sandbox_artifacts block: [label](/absolute/path). One link per line.`;

function patchText(source: string): { text: string; changed: boolean } {
  let text = source;
  let changed = false;
  if (text.includes(GET_TOOLS) && !text.includes("!server.preload")) {
    text = text.replace(GET_TOOLS, GET_TOOLS_PATCHED);
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
  }
  return { text, changed };
}

const RELATIVE_FILES = [
  "node_modules/@truefoundry/trueforge-core/dist/core/runtime/DeferredTool.js",
  "node_modules/@truefoundry/trueforge-core/dist/core/runtime/DeferredTool.mjs",
  "node_modules/@truefoundry/trueforge-core/dist/core/sandbox/Sandbox.js",
  "node_modules/@truefoundry/trueforge-core/dist/core/sandbox/Sandbox.mjs",
];

/** Patch the installed sidecar package. Missing files are skipped. */
export function applyTrueForgeSidecarPatches(root = process.cwd()): string[] {
  const patched: string[] = [];
  for (const relative of RELATIVE_FILES) {
    const file = path.join(root, relative);
    if (!fs.existsSync(file)) continue;
    const source = fs.readFileSync(file, "utf8");
    const next = patchText(source);
    if (!next.changed) continue;
    fs.writeFileSync(file, next.text);
    patched.push(relative);
  }
  return patched;
}
