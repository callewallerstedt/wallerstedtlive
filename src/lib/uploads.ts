import fs from "node:fs/promises";
import path from "node:path";

const UPLOAD_DIR = path.join(process.cwd(), "data", "uploads");

function sanitizeFilename(filename: string): string {
  return filename.replace(/[^a-zA-Z0-9_.-]/g, "_");
}

export async function saveUploadedFile(file: File): Promise<string> {
  const bytes = Buffer.from(await file.arrayBuffer());
  const safeName = sanitizeFilename(file.name || "upload.png");
  const destination = path.join(UPLOAD_DIR, `${Date.now()}-${safeName}`);

  await fs.mkdir(UPLOAD_DIR, { recursive: true });
  await fs.writeFile(destination, bytes);

  return destination;
}

export async function fileToDataUrl(absolutePath: string): Promise<string> {
  const fileData = await fs.readFile(absolutePath);
  const ext = path.extname(absolutePath).toLowerCase();

  let mime = "image/png";
  if (ext === ".jpg" || ext === ".jpeg") {
    mime = "image/jpeg";
  } else if (ext === ".webp") {
    mime = "image/webp";
  }

  return `data:${mime};base64,${fileData.toString("base64")}`;
}
