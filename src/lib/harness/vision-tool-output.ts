export type VisionTextPart = { type: "text"; text: string };
export type VisionMediaPart = {
  type: "image-data";
  mediaType: string;
  data: string;
};
export type VisionToolModelOutput = {
  type: "content";
  value: Array<VisionTextPart | VisionMediaPart>;
};

export function dataUrlToMediaPart(
  dataUrl: string,
  mime?: string,
): VisionMediaPart | null {
  if (!dataUrl.startsWith("data:image/")) return null;
  const comma = dataUrl.indexOf(",");
  if (comma < 0) return null;
  const header = dataUrl.slice("data:".length, dataUrl.indexOf(";"));
  return {
    type: "image-data",
    mediaType: mime || header || "image/png",
    data: dataUrl.slice(comma + 1),
  };
}

/** Shape a tool result so the next model step can see stored image bytes. */
export function toVisionToolModelOutput(input: {
  title?: string;
  text?: string;
  content?: string;
  mime?: string;
}): VisionToolModelOutput {
  const value: Array<VisionTextPart | VisionMediaPart> = [];
  const text = [input.title, input.text].filter(Boolean).join("\n");
  if (text) value.push({ type: "text", text });
  const media = input.content ? dataUrlToMediaPart(input.content, input.mime) : null;
  if (media) value.push(media);
  return { type: "content", value };
}
