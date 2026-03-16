import { createApp } from "./app.js";

const port = Number(process.env.V2_API_PORT || 4180);

async function main() {
  const server = await createApp();

  server.listen(port, () => {
    console.log(JSON.stringify({
      ok: true,
      app: "@kxkm/api",
      port,
    }));
  });
}

main().catch((err) => {
  console.error("Failed to start @kxkm/api:", err);
  process.exit(1);
});
