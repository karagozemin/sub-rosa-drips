import assert from 'node:assert/strict';
import test from 'node:test';
import { findViolations, scanTree } from './check-logging.mjs';
test('detects all direct logging methods, spacing and literal bracket access',()=>{
 for(const method of ['log','info','warn','error','debug']){
  assert.deepEqual(findViolations(`console.${method}('x')`),[1]);
  assert.deepEqual(findViolations(`\nconsole [ '${method}' ] ('x')`),[2]);
 }
 assert.deepEqual(findViolations("logger.info('event')"),[]);
});
test('the migrated repository has no direct console calls',()=>assert.deepEqual(scanTree(),[]));
