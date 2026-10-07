import {mkdir, readFile, readdir, copyFile, writeFile} from 'node:fs/promises';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));

export const bundles = {
  client: [
    'src/client/01-core.js',
    'src/client/02-recommendations.js',
    'src/client/03-archive.js',
    'src/client/04-events.js'
  ],
  server: [
    'src/server/01-providers.js',
    'src/server/02-storage.js',
    'src/server/03-taste-engine.js',
    'src/server/04-archive.js',
    'src/server/05-recommendations.js',
    'src/server/06-router.js'
  ]
};

export async function compose(parts) {
  return `${(await Promise.all(parts.map(file => readFile(join(root, file), 'utf8'))))
    .map(source => source.trimEnd())
    .join('\n')}\n`;
}

async function build() {
  await mkdir(join(root, 'dist/client'), {recursive: true});
  await mkdir(join(root, 'dist/server'), {recursive: true});
  await writeFile(join(root, 'dist/client/app.js'), await compose(bundles.client));
  await writeFile(join(root, 'dist/server/index.js'), await compose(bundles.server));

  // Sites serves root assets while local previews use dist/client. Keep both views in sync.
  for (const entry of await readdir(join(root, 'dist/client'), {withFileTypes: true})) {
    if (entry.isFile()) {
      await copyFile(join(root, 'dist/client', entry.name), join(root, 'dist', entry.name));
    }
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  await build();
}
