/**
 * A stand-in for Cloudflare's wrangler, for check-deploy.ts (JAM_WRANGLER names this file). It
 * uploads nothing: it writes what it was started with to FAKE_WRANGLER_LOG, then answers as
 * FAKE_WRANGLER_MODE says: "ok" (default), "no-project", "bad-token" or "echo-token" (prints the
 * token, as a careless tool might).
 */
import { appendFileSync, readdirSync } from 'node:fs';

const args = process.argv.slice(2);
const token = process.env.CLOUDFLARE_API_TOKEN ?? '';
const mode = process.env.FAKE_WRANGLER_MODE ?? 'ok';
const folder = args[0] === 'pages' && args[1] === 'deploy' ? args[2] : undefined;
if (process.env.FAKE_WRANGLER_LOG)
  appendFileSync(
    process.env.FAKE_WRANGLER_LOG,
    `${JSON.stringify({
      args,
      token,
      account: process.env.CLOUDFLARE_ACCOUNT_ID ?? '',
      ci: process.env.CI ?? '',
      files: folder ? readdirSync(folder).sort() : [],
    })}\n`,
  );
const project = args[args.indexOf('--project-name') + 1] ?? args[3] ?? 'site';
if (args[1] === 'project') {
  console.log(`✨ Successfully created the '${project}' project.`);
} else if (mode === 'no-project') {
  console.error(
    '✘ [ERROR] Project not found. The specified project name does not match any of your existing projects. [code: 8000007]',
  );
  process.exit(1);
} else if (mode === 'bad-token') {
  console.error(
    '✘ [ERROR] A request to the Cloudflare API failed. Authentication error [code: 10000]',
  );
  process.exit(1);
} else {
  if (mode === 'echo-token') console.log(`debug: using token ${token}`);
  console.log('✨ Success! Uploaded 12 files (3.21 sec)');
  console.log(
    `🌎 Deploying...\n✨ Deployment complete! Take a peek over at https://0a1b2c3d.${project}.pages.dev`,
  );
}
