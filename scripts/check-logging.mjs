#!/usr/bin/env node
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createLogger } from '../packages/logging/src/index.cjs';
const root = fileURLToPath(new URL('..', import.meta.url));
export function findViolations(text) {
  return [...text.matchAll(/\bconsole\s*(?:\.\s*(?:log|info|debug|warn|error)|\[\s*['"](?:log|info|debug|warn|error)['"]\s*\])\s*\(/g)].map(m => text.slice(0,m.index).split('\n').length);
}
export function scanTree(base=root) {
 const hits=[];
 function walk(dir) {
  for(const item of readdirSync(dir,{withFileTypes:true})) {
   if(['node_modules','dist','target','.git'].includes(item.name))continue;
   const full=join(dir,item.name), rel=relative(base,full).replaceAll('\\','/');
   if(item.isDirectory()){walk(full);continue;}
   if(!/\.(?:[cm]?js|tsx?|sh|ya?ml)$/.test(item.name)||/\.test\.|\/__tests__\//.test(rel)||rel.startsWith('packages/round-bindings/')||rel==='packages/logging/src/index.cjs')continue;
   for(const line of findViolations(readFileSync(full,'utf8')))hits.push({file:rel,line});
  }
 }
 for(const entry of ['packages','services','apps','scripts','.github'])walk(join(base,entry));
 return hits;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 const logger=createLogger('scripts.check-logging'), violations=scanTree();
 if(violations.length){logger.error('direct-console-found','Direct console calls are forbidden',{violations});process.exitCode=1;}
 else logger.info('logging-guard-passed','No direct console calls in runtime or operational scripts');
}
