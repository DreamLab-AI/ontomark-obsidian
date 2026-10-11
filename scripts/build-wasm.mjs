// Fetch a content-pinned engine release. Integrated tests can supply a candidate
// archive and its digest explicitly; production builds always use engine.json.
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdtempSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
const root=resolve(dirname(fileURLToPath(import.meta.url)), '..');
const pin=JSON.parse(readFileSync(join(root,'engine.json'),'utf8'));
const local=process.env.ONTOMARK_ENGINE_BUNDLE;
const expected=local ? process.env.ONTOMARK_ENGINE_SHA256 : pin.sha256;
if (!/^[a-f0-9]{64}$/.test(expected ?? '')) throw new Error('A SHA-256 pin is required for every engine archive');
let bytes;
if (local) bytes=readFileSync(local);
else {
  const response=await fetch(`https://github.com/${pin.repository}/releases/download/${pin.tag}/${pin.asset}`);
  if (!response.ok) throw new Error(`Engine download failed: HTTP ${response.status}`);
  bytes=Buffer.from(await response.arrayBuffer());
}
if (createHash('sha256').update(bytes).digest('hex') !== expected) throw new Error('Engine archive SHA-256 mismatch');
const temporary=mkdtempSync(join(tmpdir(),'ontomark-engine-'));
try {
  const archive=join(temporary,'engine.tar.gz');writeFileSync(archive,bytes);
  const paths=execFileSync('tar',['-tzf',archive],{encoding:'utf8'}).trim().split('\n');
  if (paths.some(p=>p.startsWith('/') || p.split('/').includes('..'))) throw new Error('Unsafe engine archive path');
  const out=join(root,'src/generated');rmSync(out,{recursive:true,force:true});mkdirSync(out,{recursive:true});
  execFileSync('tar',['-xzf',archive,'-C',out],{stdio:'inherit'});
  const receipt=JSON.parse(readFileSync(join(out,'engine-manifest.json'),'utf8'));
  if (!local && receipt.source !== pin.source) throw new Error('Engine source receipt does not match pin');
  console.log(`Verified Ontomark engine ${receipt.source} (${expected})`);
} finally {rmSync(temporary,{recursive:true,force:true});}
