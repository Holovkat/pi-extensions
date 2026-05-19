#!/usr/bin/env node
import { cpSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

const dist = 'dist/comms-package';
rmSync(dist, { recursive: true, force: true });
mkdirSync(join(dist, 'extensions'), { recursive: true });
mkdirSync(join(dist, 'scripts'), { recursive: true });
mkdirSync(join(dist, 'docs'), { recursive: true });

for (const file of [
  'package.json',
  'extensions/coms.ts',
  'extensions/coms-net.ts',
  'extensions/coms-shared.ts',
  'extensions/themeMap.ts',
  'scripts/coms-net-server.ts',
  'docs/comms.md',
]) {
  cpSync(file, join(dist, file));
}

writeFileSync(join(dist, 'README.md'), `# @holovkat/pi-comms\n\nInstall with:\n\n\`\`\`bash\npi install /absolute/path/to/comms-package\n\`\`\`\n\nSee docs/comms.md for local, localhost, LAN, and remote deployment notes.\n`);
console.log(`Built ${dist}`);
