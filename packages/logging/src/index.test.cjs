const test = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const { createLogger } = require('./index.cjs');
function capture() {
  const records = [];
  return { records, logger: createLogger('test.component', { clock: () => '2026-09-08T00:00:00.000Z', sink: (line, level) => records.push({ record: JSON.parse(line), level }) }) };
}
test('stable record shape, levels and injectable capture', () => {
  const {logger,records}=capture();
  for(const level of ['debug','info','warn','error']) logger[level]('request.finished','Done',{count:2});
  assert.equal(records.length,4);
  for(const {record,level} of records) assert.deepEqual(record,{timestamp:'2026-09-08T00:00:00.000Z',level,component:'test.component',event:'request.finished',message:'Done',context:{count:2}});
});
test('default transport routes info/debug to stdout and warning/error to stderr',()=>{
  const child=spawnSync(process.execPath,['-e',`const l=require(${JSON.stringify(require.resolve('./index.cjs'))}).createLogger('child'); for(const x of ['debug','info','warn','error'])l[x]('event');`],{encoding:'utf8'});
  assert.equal(child.status,0);
  assert.deepEqual(child.stdout.trim().split('\n').map(x=>JSON.parse(x).level),['debug','info']);
  assert.deepEqual(child.stderr.trim().split('\n').map(x=>JSON.parse(x).level),['warn','error']);
});
test('recursively redacts sensitive keys and their copies in messages',()=>{
 const {logger,records}=capture();
 const context={nested:{accessToken:'unique-access-token',private_key:'unique-private-key',password:'unique-password',authorization:'Bearer credential',cookie:'session=private'},safe:'visible'};
 logger.info('event','unique-password',context);
 const text=JSON.stringify(records);
 for(const secret of ['unique-access-token','unique-private-key','unique-password','session=private'])assert.ok(!text.includes(secret));
 assert.equal(records[0].record.context.safe,'visible');
 assert.equal(records[0].record.message,'[REDACTED]');
});
test('serializes errors, causes, bigint and circular context safely',()=>{
 const {logger,records}=capture();const context={amount:12n,error:new Error('failure',{cause:new Error('root')})};context.self=context;
 logger.error('failed','Failure',context);
 const record=records[0].record;
 assert.equal(record.context.amount,'12');assert.equal(record.context.self,'[Circular]');
 assert.equal(record.context.error.message,'failure');assert.equal(record.context.error.cause.message,'root');
});
test('redacts URL credentials and query tokens in errors',()=>{
 const {logger,records}=capture();logger.error('failed',new Error('https://user:secret@rpc.example/?token=hidden'));
 const text=JSON.stringify(records);assert.ok(!text.includes('user:secret'));assert.ok(!text.includes('token=hidden'));
});
test('hostile accessors, circular arrays, deep context and broken sinks do not throw',()=>{
 const {logger,records}=capture();const a=[];a.push(a);
 logger.info('event',undefined,{a,get token(){throw new Error('getter');},get safe(){throw new Error('getter');}});
 assert.equal(records[0].record.context.token,'[REDACTED]');assert.equal(records[0].record.context.safe,'[Accessor]');
 assert.doesNotThrow(()=>createLogger('test',{sink:()=>{throw new Error('sink');}}).info('event'));
});
