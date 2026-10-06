const BINARY_MAX_CHARS = 4_000_000;
const TEXT_MAX_CHARS = 500_000;

/**
 * Size budget for saved artifact content. File and image kinds hold base64
 * data URLs, which are never sliced: a cut data URL is not a valid image.
 */
export function fitArtifactContent(kind: string, content: string): string {
  if (kind === "file" || kind === "image") {
    if (content.length > BINARY_MAX_CHARS) {
      throw new Error(
        kind === "image" ? "Image is too large to save." : "File is too large to save.",
      );
    }
    return content;
  }
  return content.slice(0, TEXT_MAX_CHARS);
}
