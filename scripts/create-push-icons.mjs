import sharp from "sharp";
import { mkdir, writeFile } from "node:fs/promises";
const directory = new URL("../public/icons/", import.meta.url);
await mkdir(directory, { recursive: true });
const source = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><rect width="512" height="512" rx="100" fill="#2d604b"/><path d="M96 270h80l42-112 72 204 42-92h84" fill="none" stroke="#ffffff" stroke-width="28" stroke-linecap="round" stroke-linejoin="round"/></svg>';
await writeFile(new URL("mark.svg", directory), source);
for (const [name, size] of [["icon-192", 192], ["icon-512", 512], ["apple-touch-icon", 180]]) await sharp(Buffer.from(source)).resize(size, size).withMetadata({ exif: { IFD0: { ImageDescription: "Original Kontur geometric pulse mark; source scripts/create-push-icons.mjs and public/icons/mark.svg. Authored vector, no generated or stock imagery." } } }).png().toFile(new URL(`${name}.png`, directory).pathname.replace(/^\/(?:([a-zA-Z]):)/, "$1:"));
const badge = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 96"><path d="M8 51h19l8-26 15 47 12-21h26" fill="none" stroke="white" stroke-width="8" stroke-linecap="round" stroke-linejoin="round"/></svg>';
await sharp(Buffer.from(badge)).png().withMetadata({ exif: { IFD0: { ImageDescription: "Original monochrome Kontur pulse badge; exact vector source scripts/create-push-icons.mjs." } } }).toFile(new URL("badge.png", directory).pathname.replace(/^\/(?:([a-zA-Z]):)/, "$1:"));
