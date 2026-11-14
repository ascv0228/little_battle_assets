import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { parseFeed, discover } from './discover.mjs';
import { validateDescriptor, readZipEntries, importApproved } from './import-approved.mjs';
import { sha256, safeRelative, isPublicAddress, validateRemoteUrl, fetchBytes } from './common.mjs';

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aNCkAAAAASUVORK5CYII=', 'base64');
function descriptor() {
  const clip = { source_frame_size:[1,1], output_frame_size:[2,2], anchor:[1,2], label_offset:[0,-3], durations:[0.5], loop:false, layers:[{file:'body.png',row:0,columns:[0]}] };
  return {schema_version:1,source:{page_url:'https://artist.itch.io/creature',author:'Artist',license:{id:'CC0-1.0',evidence_url:'https://artist.itch.io/creature',reviewed_by:'Project owner',reviewed_at:'2026-11-14',game_use:true,asset_redistribution:true},downloads:[{url:'https://img.itch.zone/body.png',format:'png',destination:'body.png',sha256:sha256(png)}]},character:{schema_version:1,id:'monster_test',name:'Test',type:'monster',faction:'ENEMY',stats:{hp:100,atk:20,defense:2,attack_range:50,attack_interval:1},equipment:[],behavior:{type:'advance_and_area_attack',move_speed:50,hit_time:0.2,death_fade_seconds:1}},animations:{walk:structuredClone(clip),attack:structuredClone(clip),death:structuredClone(clip)}};
}

function zip(name, data=png, attrs=0) {
  const filename=Buffer.from(name), local=Buffer.alloc(30), central=Buffer.alloc(46), end=Buffer.alloc(22);
  local.writeUInt32LE(0x04034b50); local.writeUInt32LE(data.length,18); local.writeUInt32LE(data.length,22); local.writeUInt16LE(filename.length,26);
  central.writeUInt32LE(0x02014b50); central.writeUInt32LE(data.length,20); central.writeUInt32LE(data.length,24); central.writeUInt16LE(filename.length,28); central.writeUInt32LE(attrs>>>0,38);
  const entry=Buffer.concat([local,filename,data]), directory=Buffer.concat([central,filename]);
  end.writeUInt32LE(0x06054b50); end.writeUInt16LE(1,8); end.writeUInt16LE(1,10); end.writeUInt32LE(directory.length,12); end.writeUInt32LE(entry.length,16);
  return Buffer.concat([entry,directory,end]);
}

test('RSS parses provenance while keeping every free asset quarantined',()=>{
  const result=parseFeed('<rss><channel><item><title><![CDATA[Free &amp; Green Monster]]></title><link>https://artist.itch.io/monster</link><dc:creator>Artist</dc:creator></item><item><link>https://evil.example/x</link></item></channel></rss>');
  assert.equal(result.length,1); assert.equal(result[0].title,'Free & Green Monster'); assert.equal(result[0].status,'quarantined'); assert.equal(result[0].license,null); assert.equal(result[0].author,'Artist');
  assert.throws(()=>parseFeed('<!DOCTYPE a><rss/>'));
});

test('RSS discovery deduplicates sources and records feed failures', async()=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'lb-discovery-'));
  try {
    const configPath=path.join(root,'config.json'),outputPath=path.join(root,'queue.json');
    await fs.writeFile(configPath,JSON.stringify({feeds:['https://itch.io/game-assets/free/tag-monsters.xml','https://itch.io/game-assets/free/tag-animals.xml']}));
    const download=async url=>{if(url.includes('animals'))throw Error('network failure');return Buffer.from('<rss><item><title>Monster</title><link>https://artist.itch.io/m</link></item></rss>');};
    await discover({configPath,outputPath,download});
    const report=await discover({configPath,outputPath,download});
    assert.equal(report.candidates.length,1); assert.equal(report.feeds[1].status,'failed'); assert.equal(report.candidates[0].status,'quarantined');
  } finally {await fs.rm(root,{recursive:true,force:true});}
});

test('review requires source evidence, redistribution permission and exact hashes',()=>{
  const data=descriptor(); assert.equal(validateDescriptor(data).size,1);
  data.source.license.asset_redistribution=false; assert.throws(()=>validateDescriptor(data),/permission/);
  data.source.license.asset_redistribution=true; data.source.downloads[0].sha256='unknown'; assert.throws(()=>validateDescriptor(data),/SHA256/);
});

test('unsafe frame maps and unsupported executable behaviors are rejected',()=>{
  const data=descriptor(); data.animations.attack.layers[0].file='../outside.png'; assert.throws(()=>validateDescriptor(data));
  data.animations.attack.layers[0].file='body.png'; data.character.behavior.type='eval'; assert.throws(()=>validateDescriptor(data));
});

test('archive reader permits mapped PNG but rejects traversal and symlinks',()=>{
  assert.deepEqual(readZipEntries(zip('sprites/body.png')).get('sprites/body.png'),png);
  assert.throws(()=>readZipEntries(zip('../outside.png')),/Unsafe/);
  assert.throws(()=>readZipEntries(zip('link.png',png,0xa000<<16)),/symbolic/);
  assert.throws(()=>safeRelative('C:/secret.env')); assert.throws(()=>safeRelative('..\\secret.env'));
});

test('approved imports preserve provenance and recipe, never replace a character',async()=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'lb-import-'));
  try {
    const data=descriptor();
    const dry=await importApproved(data,{root,download:async()=>png,dryRun:true}); assert.equal(dry.imported,false);
    const result=await importApproved(data,{root,download:async()=>png}); assert.equal(result.imported,true);
    const recipe=JSON.parse(await fs.readFile(path.join(root,'asset_sources/characters/monster_test.json'),'utf8'));
    assert.equal(recipe.source_root,'other_assets/imported/monster_test');
    const provenance=JSON.parse(await fs.readFile(path.join(root,'other_assets/imported/monster_test/provenance.json'),'utf8'));
    assert.equal(provenance.author,'Artist');
    await assert.rejects(importApproved(data,{root,download:async()=>png}),/not be overwritten/);
  } finally {await fs.rm(root,{recursive:true,force:true});}
});

test('download digest failure writes no source or recipe',async()=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'lb-bad-import-'));
  try {
    await assert.rejects(importApproved(descriptor(),{root,download:async()=>Buffer.from('wrong')}),/SHA256 mismatch/);
    await assert.rejects(fs.access(path.join(root,'other_assets/imported/monster_test')));
    await assert.rejects(fs.access(path.join(root,'asset_sources/characters/monster_test.json')));
  } finally {await fs.rm(root,{recursive:true,force:true});}
});

test('network requests reject local URLs and private DNS results',async()=>{
  assert.equal(isPublicAddress('127.0.0.1'),false); assert.equal(isPublicAddress('10.0.0.2'),false); assert.equal(isPublicAddress('::1'),false); assert.equal(isPublicAddress('8.8.8.8'),true);
  assert.throws(()=>validateRemoteUrl('http://artist.itch.io/file.png')); assert.throws(()=>validateRemoteUrl('https://127.0.0.1/file.png'));
  await assert.rejects(fetchBytes('https://artist.itch.io/file.png',{dnsLookup:async()=>[{address:'192.168.0.1'}],fetchImpl:async()=>{throw Error('must not fetch');}}),/Private/);
});
