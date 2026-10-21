import { loadConfig } from "./config.js";
import { buildServer } from "./server.js";

async function main(): Promise<void> {
  const config = loadConfig();
  const { app } = await buildServer(config);

  const host = config.controller.host;
  const port = config.controller.port;

  await app.listen({ host, port });
  app.log.info(
    {
      moduleWs: `ws://${host}:${port}${config.controller.moduleWsPath}`,
      dashboardWs: `ws://${host}:${port}${config.controller.dashboardWsPath}`,
      health: `http://${host}:${port}/health`,
    },
    "ECHO controller listening",
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
