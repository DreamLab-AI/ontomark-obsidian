// Build-time packaging only. Installed users need Obsidian, not Node.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
const manifest=JSON.parse(readFileSync('manifest.json','utf8'));
if (!/^\d+\.\d+\.\d+$/.test(manifest.version) || manifest.id !== 'ontomark') throw new Error('Invalid release identity');
const output=resolve('release');const stage=join(output,'ontomark');
mkdirSync(stage,{recursive:true});
for (const file of ['main.js','manifest.json','styles.css']) cpSync(join('dist',file),join(stage,file));
for (const file of ['LICENSE-MIT','LICENSE-APACHE','NOTICE']) cpSync(file,join(stage,file));
const name=`ontomark-obsidian-${manifest.version}.zip`;const archive=join(output,name);
rmSync(archive,{force:true});
execFileSync('zip',['-q','-X','-r',archive,'ontomark'],{cwd:output,stdio:'inherit'});
const digest=createHash('sha256').update(readFileSync(archive)).digest('hex');
writeFileSync(archive+'.sha256',`${digest}  ${name}\n`);
rmSync(stage,{recursive:true,force:true});
console.log(`${archive}\nSHA-256 ${digest}`);
