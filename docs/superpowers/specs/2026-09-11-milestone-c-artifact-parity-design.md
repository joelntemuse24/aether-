# Milestone C — Claude artifact parity (2026-09-11)

Small, complete increment on A+B. No D/E/F (browse_page, Drive write, TTS, ffmpeg, Figma). Cream canvas unchanged — objects only.

## Artifact kinds

Canonical: `markdown | code | html | react | svg | csv | image | pptx | xlsx | docx | pdf`.

Aliases kept for existing rows and tools: `document` → markdown, `data` → csv, `file` → binary catch-all (office tools still persist as `file`).

## Live preview

HTML and React open in a sandboxed iframe: `sandbox="allow-scripts"` and **no** `allow-same-origin` (no parent cookie access). HTML uses `srcDoc`. React reuses the existing in-iframe Babel/UMD path. Download keeps binary files and also saves HTML/React source.

## Versions + diff

Every persist (cloud + local) appends `versions[]` `{ n, content, createdAt }` (cap 20). Panel stepper walks versions. Text kinds show a basic line diff vs the previous version.

## Provenance

Lightweight `provenance[]` `{ tool, at }` from the producing Aether tool (`create_artifact`, `workspace_publish_file`, office builders). UI row uses tool display labels (no vendor names).

## Project knowledge

Upload `pdf/docx/md/txt/csv` onto a project. Extract + chunk. `project_knowledge_search({ query, projectId })` returns ranked chunks. Small corpora stay in the project system-prompt block; over ~16k chars the prompt flips to RAG and tells the model to search.

Confirm only for irreversible/spend — this tool is a safe read.
