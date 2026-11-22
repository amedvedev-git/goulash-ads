import { update } from '../../deploy/manage-release.ts';
import type { Paths, Host } from '../../deploy/manage-release.ts';

const paths = JSON.parse(process.argv[2]) as Paths;
const host: Host = {
  async checkBefore() {}, async stop() {}, async health() {},
  async start() { process.exit(91); }, // Simulate process death after replacement/migration, before health/commit.
};
await update(paths, host, process.argv[3]);
