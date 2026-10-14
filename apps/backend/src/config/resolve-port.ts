// PD-DEP1 (public-demo audit): Render injects `PORT`; local dev uses APP_PORT.
// Kept in its own module (no Nest imports) so it stays unit-testable without
// booting NestFactory.
export function resolvePort(env: NodeJS.ProcessEnv = process.env): number {
  const port = Number(env.PORT) || Number(env.APP_PORT) || 3001;
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw new Error(`Invalid port configuration: PORT=${String(env.PORT)} APP_PORT=${String(env.APP_PORT)}`);
  }
  return port;
}
