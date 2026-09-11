/**
 * ffmpeg via the isolated workspace. Honest when the binary is MISSING.
 * Paths stay workspace-relative — no shell interpolation of user strings.
 */

const SAFE_PATH = /^(?!\/)(?!.*\.\.)[A-Za-z0-9._/-]+$/;
const SAFE_TIME = /^[0-9:.]+$/;

export const FFMPEG_MISSING_MESSAGE =
  "ffmpeg is not available in this workspace (MISSING). Trim, concat, GIF, and burned-in captions cannot run until an operator installs it. Do not invent a video.";

export type FfmpegAction = "trim" | "concat" | "gif" | "burn_subs";

export type FfmpegCommandInput = {
  action: FfmpegAction;
  inputPath: string;
  outputPath: string;
  extraInputs?: string[];
  start?: string;
  duration?: string;
  subsPath?: string;
};

export type FfmpegCommandResult =
  | { ok: true; command: string }
  | { ok: false; error: string; command?: undefined };

function safePath(value: string | undefined, label: string): string | null {
  const trimmed = (value ?? "").trim();
  if (!trimmed || !SAFE_PATH.test(trimmed)) return null;
  if (trimmed.startsWith("-")) return null;
  void label;
  return trimmed;
}

function safeTime(value: string | undefined): string | null {
  const trimmed = (value ?? "").trim();
  if (!trimmed) return null;
  return SAFE_TIME.test(trimmed) ? trimmed : null;
}

export function buildFfmpegCommand(input: FfmpegCommandInput): FfmpegCommandResult {
  const inputPath = safePath(input.inputPath, "input");
  const outputPath = safePath(input.outputPath, "output");
  if (!inputPath || !outputPath) {
    return { ok: false, error: "Use workspace-relative media paths only." };
  }

  if (input.action === "trim") {
    const start = safeTime(input.start) ?? "00:00:00";
    const duration = safeTime(input.duration);
    const durationArg = duration ? ` -t ${duration}` : "";
    return {
      ok: true,
      command: `ffmpeg -y -ss ${start}${durationArg} -i ${inputPath} -c copy ${outputPath}`,
    };
  }

  if (input.action === "concat") {
    const extras = (input.extraInputs ?? [])
      .map((p) => safePath(p, "extra"))
      .filter((p): p is string => !!p);
    if (extras.length === 0) {
      return { ok: false, error: "concat needs at least one extra input path." };
    }
    const inputs = [inputPath, ...extras].map((p) => `-i ${p}`).join(" ");
    const n = extras.length + 1;
    const concatFilter = Array.from({ length: n }, (_, i) => `[${i}:v][${i}:a]`).join("") +
      `concat=n=${n}:v=1:a=1[v][a]`;
    return {
      ok: true,
      command: `ffmpeg -y ${inputs} -filter_complex "${concatFilter}" -map "[v]" -map "[a]" ${outputPath}`,
    };
  }

  if (input.action === "gif") {
    return {
      ok: true,
      command: `ffmpeg -y -i ${inputPath} -vf "fps=12,scale=480:-1:flags=lanczos" ${outputPath}`,
    };
  }

  if (input.action === "burn_subs") {
    const subsPath = safePath(input.subsPath, "subs");
    if (!subsPath) {
      return { ok: false, error: "burn_subs needs a workspace-relative captions file." };
    }
    return {
      ok: true,
      command: `ffmpeg -y -i ${inputPath} -vf "subtitles=${subsPath}" ${outputPath}`,
    };
  }

  return { ok: false, error: "Use trim, concat, gif, or burn_subs." };
}

export function annotateWorkspaceCommandResult(input: {
  command: string;
  exitCode: number;
  stdout?: string;
  stderr?: string;
  error?: string;
}): {
  ok: boolean;
  exitCode: number;
  stdout?: string;
  stderr?: string;
  error?: string;
  missing?: string;
} {
  const blob = `${input.stdout ?? ""}\n${input.stderr ?? ""}\n${input.error ?? ""}`;
  const looksMissing =
    input.exitCode === 127 ||
    /not found|command not found|No such file or directory/i.test(blob);
  const mentionsFfmpeg = /\bffmpeg\b|\bffprobe\b/i.test(input.command);
  if (looksMissing && mentionsFfmpeg && input.exitCode !== 0) {
    return {
      ok: false,
      exitCode: input.exitCode,
      stdout: input.stdout,
      stderr: input.stderr,
      missing: "ffmpeg",
      error: FFMPEG_MISSING_MESSAGE,
    };
  }
  if (looksMissing && input.exitCode !== 0) {
    const cmd = input.command.trim().split(/\s+/)[0] || "command";
    return {
      ok: false,
      exitCode: input.exitCode,
      stdout: input.stdout,
      stderr: input.stderr,
      missing: cmd,
      error: `The workspace does not have “${cmd}”. Say so — do not pretend the command ran.`,
    };
  }
  return {
    ok: input.exitCode === 0,
    exitCode: input.exitCode,
    stdout: input.stdout,
    stderr: input.stderr,
    error: input.error,
  };
}
