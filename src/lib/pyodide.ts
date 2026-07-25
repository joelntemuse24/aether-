"use client";

import type { ExecutePythonOutput } from "./tools";

/**
 * Loads Pyodide from the official CDN (never bundled) and runs Python code in a
 * sandboxed web worker so a long-running script cannot freeze the UI and can be
 * hard-terminated on timeout.
 */

const PYODIDE_VERSION = "0.26.4";
const PYODIDE_CDN = `https://cdn.jsdelivr.net/pyodide/v${PYODIDE_VERSION}/full/`;

const DEFAULT_TIMEOUT_MS = 30_000;

// The worker source is built as a string so it can be spun up from a Blob URL
// without needing a separate bundled worker file.
function buildWorkerSource(): string {
  return `
    let pyodideReadyPromise = null;

    async function loadPyodideOnce() {
      if (!pyodideReadyPromise) {
        importScripts("${PYODIDE_CDN}pyodide.js");
        pyodideReadyPromise = self.loadPyodide({ indexURL: "${PYODIDE_CDN}" });
      }
      return pyodideReadyPromise;
    }

    self.onmessage = async (event) => {
      const { id, code } = event.data;
      const start = Date.now();
      try {
        const pyodide = await loadPyodideOnce();
        let stdout = "";
        pyodide.setStdout({ batched: (s) => { stdout += s + "\\n"; } });
        pyodide.setStderr({ batched: (s) => { stdout += s + "\\n"; } });

        // Best-effort auto-install of imported packages available in Pyodide.
        try {
          await pyodide.loadPackagesFromImports(code);
        } catch (_) { /* ignore optional package load failures */ }

        const result = await pyodide.runPythonAsync(code);
        const resultStr =
          result === undefined || result === null ? undefined : String(result);

        self.postMessage({
          id,
          ok: true,
          stdout,
          result: resultStr,
          durationMs: Date.now() - start,
        });
      } catch (err) {
        self.postMessage({
          id,
          ok: false,
          stdout: "",
          error: err && err.message ? err.message : String(err),
          durationMs: Date.now() - start,
        });
      }
    };
  `;
}

let worker: Worker | null = null;
let workerUrl: string | null = null;

function getWorker(): Worker {
  if (worker) return worker;
  const blob = new Blob([buildWorkerSource()], {
    type: "application/javascript",
  });
  workerUrl = URL.createObjectURL(blob);
  worker = new Worker(workerUrl);
  return worker;
}

function resetWorker() {
  if (worker) {
    worker.terminate();
    worker = null;
  }
  if (workerUrl) {
    URL.revokeObjectURL(workerUrl);
    workerUrl = null;
  }
}

let callCounter = 0;

/**
 * Runs Python code with a hard timeout. On timeout the worker is terminated so
 * runaway scripts cannot keep consuming resources.
 */
export function runPython(
  code: string,
  timeoutMs: number = DEFAULT_TIMEOUT_MS,
): Promise<ExecutePythonOutput> {
  if (typeof window === "undefined") {
    return Promise.resolve({
      ok: false,
      stdout: "",
      error: "Python execution is only available in the browser.",
    });
  }

  const activeWorker = getWorker();
  const id = ++callCounter;

  return new Promise<ExecutePythonOutput>((resolve) => {
    const timer = window.setTimeout(() => {
      cleanup();
      // Kill the frozen worker; the next run starts a fresh one.
      resetWorker();
      resolve({
        ok: false,
        stdout: "",
        error: `Execution timed out after ${Math.round(timeoutMs / 1000)}s.`,
      });
    }, timeoutMs);

    function cleanup() {
      window.clearTimeout(timer);
      activeWorker.removeEventListener("message", onMessage);
      activeWorker.removeEventListener("error", onError);
    }

    function onMessage(e: MessageEvent) {
      if (e.data?.id !== id) return;
      cleanup();
      const { ok, stdout, result, error, durationMs } = e.data;
      resolve({ ok, stdout: stdout ?? "", result, error, durationMs });
    }

    function onError(e: ErrorEvent) {
      cleanup();
      resetWorker();
      resolve({
        ok: false,
        stdout: "",
        error: e.message || "Worker error while running Python.",
      });
    }

    activeWorker.addEventListener("message", onMessage);
    activeWorker.addEventListener("error", onError);
    activeWorker.postMessage({ id, code });
  });
}
