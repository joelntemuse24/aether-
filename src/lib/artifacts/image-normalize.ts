import { bufferToDataUrl, mimeForFilename } from "@/lib/office/file-artifact";
import { classifyImageContent } from "./image-result";

export type NormalizedImage =
  | { ok: true; content: string; mime?: string }
  | { ok: false; error: string };

type Identity = { userId?: string | null; conversationId?: string | null };

type ReadBinary = (
  identity: Identity,
  input: { path: string },
) => Promise<
  { ok: true; buffer: Buffer } | { ok: false; error: string }
>;

const NOT_AN_IMAGE =
  "Image content must be a data:image URL, raw base64, an https URL, or the sandbox path of a PNG/JPEG/WebP/GIF file. Pass the file path (for example /home/user/chart.png) or publish the file with workspace_publish_file.";

/**
 * Turn whatever the model passed as an image artifact's content into something
 * the Preview can paint. A sandbox path becomes the file's bytes; an unreadable
 * path fails loudly instead of saving the path string as an image.
 */
export async function normalizeImageContent(input: {
  content: string;
  language?: string;
  identity: Identity;
  read: ReadBinary;
}): Promise<NormalizedImage> {
  const hint = input.language ? mimeForFilename(input.language) : undefined;
  const mimeHint = hint?.startsWith("image/") ? hint : undefined;
  const classified = classifyImageContent(input.content, mimeHint);
  switch (classified.type) {
    case "data-url":
    case "base64":
      return { ok: true, content: classified.dataUrl };
    case "url":
      return { ok: true, content: classified.url };
    case "path": {
      const mime = mimeForFilename(classified.path);
      if (!mime.startsWith("image/")) {
        return {
          ok: false,
          error: `${classified.path} is not an image file (png, jpg, webp, gif, svg).`,
        };
      }
      const file = await input.read(input.identity, { path: classified.path });
      if (!file.ok) {
        return {
          ok: false,
          error: `Could not read the image at ${classified.path}: ${file.error || "file not found"}. Check the path with workspace_list_files, or publish it with workspace_publish_file.`,
        };
      }
      return { ok: true, content: bufferToDataUrl(file.buffer, mime), mime };
    }
    default:
      return { ok: false, error: NOT_AN_IMAGE };
  }
}
