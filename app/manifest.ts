import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Jarvis — Personal AI Agent",
    short_name: "Jarvis",
    description: "Your personal AI agent, powered by Claude.",
    start_url: "/",
    display: "standalone",
    background_color: "#fff4e4",
    theme_color: "#fff4e4",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
      {
        src: "/icon-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
