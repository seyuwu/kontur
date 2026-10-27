import type { MetadataRoute } from "next";
export default function manifest(): MetadataRoute.Manifest {
  return { id: "/", name: "Контур — кабинет врача", short_name: "Контур", lang: "ru", start_url: "/doctor", scope: "/", display: "standalone", background_color: "#f4f6f2", theme_color: "#2d5d4b", icons: [{ src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" }, { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" }] };
}
