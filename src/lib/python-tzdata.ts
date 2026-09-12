/**
 * IANA time zones for execute_python (Pyodide) and workspace Python.
 * CPython's zoneinfo needs the tzdata package when the OS has no zoneinfo.
 */

export const TZDATA_PIP_PACKAGE = "tzdata";

/** Probe Europe/Dublin, then pip-install tzdata if ZoneInfo cannot resolve it. */
export const WORKSPACE_ENSURE_TZDATA_COMMAND =
  'python3 -c "from zoneinfo import ZoneInfo; ZoneInfo(\'Europe/Dublin\')" >/dev/null 2>&1 || python3 -m pip install -q tzdata';

const PYTHON_CMD = /(^|[\s;&|])(python3?|pyodide)\b|zoneinfo|from zoneinfo/i;

export function looksLikePythonWorkspaceCommand(command: string): boolean {
  return PYTHON_CMD.test(command);
}

/** Prefix python workspace commands so ZoneInfo("Europe/Dublin") works. */
export function wrapWorkspaceCommandForPythonTzdata(command: string): string {
  const trimmed = command.trim();
  if (!trimmed || !looksLikePythonWorkspaceCommand(trimmed)) return command;
  if (trimmed.includes("pip install") && /tzdata/.test(trimmed)) return command;
  return `${WORKSPACE_ENSURE_TZDATA_COMMAND} && ${trimmed}`;
}

/** Run user code via a quoted heredoc so multi-line snippets stay intact. */
export function workspacePythonCommand(code: string): string {
  const trimmed = code.trim();
  let token = "AETHER_PY";
  let n = 0;
  while (trimmed.includes(token)) {
    n += 1;
    token = `AETHER_PY_${n}`;
  }
  return `python3 - <<'${token}'\n${trimmed}\n${token}`;
}
