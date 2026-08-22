"""Aether-owned tools: Hermes asks, Aether executes with the user session."""

from __future__ import annotations

import json
import os
import urllib.error
import urllib.request

_SESSION = {"key": ""}


def _session_key(**kwargs) -> str:
    return (
        kwargs.get("session_key")
        or kwargs.get("gateway_session_key")
        or kwargs.get("session_id")
        or _SESSION.get("key")
        or ""
    )


def _callback(name: str, params: dict, **kwargs) -> str:
    base = (os.environ.get("AETHER_TOOLS_URL") or "").rstrip("/")
    token = (
        os.environ.get("AETHER_TOOLS_TOKEN")
        or os.environ.get("API_SERVER_KEY")
        or ""
    )
    if not base:
        return json.dumps(
            {
                "ok": False,
                "error": "Aether tools URL is not configured on this host.",
            }
        )
    session_key = _session_key(**kwargs)
    body = json.dumps(
        {
            "name": name,
            "arguments": params or {},
            "session_key": session_key,
        }
    ).encode("utf-8")
    req = urllib.request.Request(
        f"{base}/api/hermes/aether-tools",
        data=body,
        method="POST",
        headers={
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json",
            "X-Hermes-Session-Key": session_key[:256],
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            return resp.read().decode("utf-8")
    except urllib.error.HTTPError as err:
        detail = err.read().decode("utf-8", errors="replace")[:800]
        return json.dumps(
            {"ok": False, "error": f"Aether tool failed ({err.code})", "detail": detail}
        )
    except Exception as err:  # noqa: BLE001 — host must never crash the tool loop
        return json.dumps({"ok": False, "error": str(err)})


def _schema(name: str, description: str, properties: dict, required: list[str]) -> dict:
    return {
        "name": name,
        "description": description,
        "parameters": {
            "type": "object",
            "properties": properties,
            "required": required,
        },
    }


def register(ctx):
    tools = [
        (
            "memory_search",
            "Search the user's curated long-term Aether memory.",
            {"query": {"type": "string", "description": "Search query"}},
            ["query"],
        ),
        (
            "memory_write",
            "Write or update a lasting Aether memory about the user.",
            {
                "title": {"type": "string"},
                "body": {"type": "string"},
                "type": {"type": "string"},
                "importance": {"type": "string"},
                "id": {"type": "string"},
            },
            ["title", "body"],
        ),
        (
            "create_artifact",
            "Create a reusable Aether artifact (document, code, data, image, svg).",
            {
                "kind": {"type": "string"},
                "title": {"type": "string"},
                "content": {"type": "string"},
                "language": {"type": "string"},
            },
            ["title", "content"],
        ),
        (
            "request_confirmation",
            "Ask the user to approve a destructive, spend, submit, or delete action.",
            {
                "action": {"type": "string"},
                "title": {"type": "string"},
                "preview": {"type": "string"},
                "target": {"type": "string"},
            },
            ["action", "title", "preview"],
        ),
        (
            "drive_search",
            "Search the user's connected Google Drive by file name.",
            {"query": {"type": "string"}},
            ["query"],
        ),
        (
            "drive_read",
            "Read a Google Drive file as text. Pass a file id from drive_search.",
            {"fileId": {"type": "string"}},
            ["fileId"],
        ),
        (
            "github_get_repo",
            "Get metadata for a GitHub repository the signed-in user can access.",
            {"repo": {"type": "string"}},
            ["repo"],
        ),
        (
            "github_list_contents",
            "List files and folders at a path in a GitHub repository.",
            {
                "repo": {"type": "string"},
                "path": {"type": "string"},
                "ref": {"type": "string"},
            },
            ["repo"],
        ),
        (
            "github_read_file",
            "Read one text file from a GitHub repository.",
            {
                "repo": {"type": "string"},
                "path": {"type": "string"},
                "ref": {"type": "string"},
            },
            ["repo", "path"],
        ),
    ]

    for name, description, properties, required in tools:
        def handler(params, _name=name, **kwargs):
            return _callback(_name, params or {}, **kwargs)

        ctx.register_tool(
            name=name,
            toolset="aether",
            schema=_schema(name, description, properties, required),
            handler=handler,
        )

    def on_session_start(*_args, **kwargs):
        key = _session_key(**kwargs)
        if key:
            _SESSION["key"] = str(key)

    ctx.register_hook("on_session_start", on_session_start)
