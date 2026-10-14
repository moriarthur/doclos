// PD-R6 (public-demo audit): build an ioredis-compatible options object from
// REDIS_URL when present — the primary deployment shape is an Upstash TLS URL
// (user-confirmed decision; Render Key Value is fallback-only and also hands
// you a URL). REDIS_HOST/REDIS_PORT remain the local-docker fallback. The old
// code only fished a password out of the URL with a regex, so a managed
// REDIS_URL would have been silently ignored in favor of localhost defaults.
export function redisConnectionOptions() {
  const redisUrl = process.env.REDIS_URL;
  if (redisUrl) {
    const parsed = new URL(redisUrl);
    return {
      host: parsed.hostname,
      port: parsed.port ? parseInt(parsed.port, 10) : 6379,
      username:
        parsed.username && parsed.username !== 'default'
          ? decodeURIComponent(parsed.username)
          : undefined,
      password: parsed.password ? decodeURIComponent(parsed.password) : undefined,
      db: parsed.pathname.length > 1 ? parseInt(parsed.pathname.slice(1), 10) : undefined,
      tls: parsed.protocol === 'rediss:' ? {} : undefined,
      // Required by Bull: the worker pulls jobs with a blocking command
      // (BRPOPLPUSH). Without these, ioredis aborts that blocking request
      // after its retry limit once a managed Redis drops an idle connection,
      // and the worker permanently stops consuming the queue (jobs pile up in
      // "wait" with active=0). maxRetriesPerRequest:null disables that limit;
      // enableReadyCheck:false avoids ready-check stalls on the bclient.
      maxRetriesPerRequest: null as null,
      enableReadyCheck: false,
    };
  }
  return {
    host: process.env.REDIS_HOST || 'localhost',
    port: parseInt(process.env.REDIS_PORT || '6379', 10),
    maxRetriesPerRequest: null as null,
    enableReadyCheck: false,
  };
}
