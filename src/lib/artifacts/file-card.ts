export type FilePreviewKind = "pptx" | "xlsx" | "pdf" | "png";

/** In-chat preview cards for the file types the panel can hand back. */
export function filePreviewKind(input: {
  kind?: string;
  filename?: string;
  mime?: string;
}): FilePreviewKind | null {
  const blob = `${input.kind || ""} ${input.filename || ""} ${input.mime || ""}`.toLowerCase();
  if (/\.pptx\b|\bpptx\b|presentationml/.test(blob)) return "pptx";
  if (/\.xlsx\b|\bxlsx\b|spreadsheetml/.test(blob)) return "xlsx";
  if (/\.pdf\b|\bpdf\b|application\/pdf/.test(blob)) return "pdf";
  if (/\.png\b|\bpng\b|image\/png/.test(blob)) return "png";
  return null;
}
