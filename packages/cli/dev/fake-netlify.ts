/**
 * A stand-in for Netlify's CLI, for check-deploy.ts (JAM_NETLIFY names this file). It uploads
 * nothing: it writes what it was started with to FAKE_NETLIFY_LOG, then answers as
 * FAKE_NETLIFY_MODE says: "ok" (default), "no-site" or "echo-token".
 */
import { appendFileSync, readdirSync } from 'node:fs';

const args = process.argv.slice(2);
const token = process.env.NETLIFY_AUTH_TOKEN ?? '';
const mode = process.env.FAKE_NETLIFY_MODE ?? 'ok';
const value = (flag: string) => (args.includes(flag) ? args[args.indexOf(flag) + 1] : undefined);
const folder = value('--dir');
if (process.env.FAKE_NETLIFY_LOG)
  appendFileSync(
    process.env.FAKE_NETLIFY_LOG,
    `${JSON.stringify({
      args,
      token,
      cwd: process.cwd(),
      files: folder ? readdirSync(folder).sort() : [],
    })}\n`,
  );
const site = value('--site') ?? value('--site-name') ?? 'site';
if (mode === 'no-site') {
  console.error(`Error: Project not found. Please rerun "netlify link"`);
  process.exit(1);
}
if (mode === 'echo-token') console.log(`debug: token ${token}`);
const alias = value('--alias');
console.log(`Deploy path: ${folder}`);
if (alias) console.log(`Draft deploy is live!\nDraft URL: https://${alias}--${site}.netlify.app`);
else
  console.log(
    `Deploy is live!\nUnique deploy URL: https://0a1b2c3d4e5f--${site}.netlify.app\nProduction URL: https://${site}.netlify.app`,
  );
