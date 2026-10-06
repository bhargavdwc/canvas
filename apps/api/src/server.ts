import { loadConfig } from './config';
import { createAppContext, buildApp } from './app';
// Spatial Message World Server — with Supabase repository support
async function main() {
  const config = loadConfig(process.env);
  const ctx = await createAppContext(config);
  const app = await buildApp(ctx);

  const shutdown = async (signal: string) => {
    app.log.info(`Received ${signal}. Gracefully shutting down...`);
    await app.close();
    await ctx.rateLimiter.close();
    await ctx.repo.close();
    process.exit(0);
  };

  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));

  try {
    const address = await app.listen({
      port: config.API_PORT,
      host: config.HOST,
    });
    app.log.info(`Spatial Message World API running at ${address}`);
  } catch (err) {
    app.log.fatal(err);
    process.exit(1);
  }
}

void main();
