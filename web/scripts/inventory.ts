import { readdir, readFile, writeFile, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { canonical, requireThat, safePath } from '../src/integrity';

async function files(dir: string, prefix = ''): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const nested = await Promise.all(entries.map(e => e.isDirectory() ? files(`${dir}/${e.name}`, `${prefix}${e.name}/`) : [`${prefix}${e.name}`]));
  return nested.flat().sort();
}
const h = JSON.parse(await readFile('data/handoff.json', 'utf8'));
const paths = (await files('../dist')).filter(p => p !== 'imd-deployment.json');
requireThat(paths.includes('index.html') && paths.length <= 128, 'Export asset count invalid');
let total = 0;
const assets = await Promise.all(paths.map(async path => {
  safePath(path);
  const size = (await stat(`../dist/${path}`)).size;
  requireThat(size <= 8388608, 'Asset over size limit'); total += size;
  return { path, sha256: createHash('sha256').update(await readFile(`../dist/${path}`)).digest('hex') };
}));
requireThat(total < 8 * 1024 * 1024, 'Export exceeds submission budget');
const manifest = { version: 1, launchId: h.launchId, chainId: h.chainId, sourceCommit: h.sourceCommit,
  attestationHash: h.attestationHash,
  contracts: h.contracts.map(({name,address,abiHash}: {name:string;address:string;abiHash:string}) => ({name,address,abiHash,abiPath:`abi/${name}.json`})), assets };
if (process.argv.includes('--check')) {
  requireThat(canonical(manifest) === canonical(JSON.parse(await readFile('../dist/imd-deployment.json', 'utf8'))), 'Export inventory mismatch');
} else await writeFile('../dist/imd-deployment.json', JSON.stringify(manifest, null, 2) + '\n');
console.log(`${process.argv.includes('--check') ? 'Verified' : 'Wrote'} manifest: ${paths.length} assets, ${total} bytes.`);
