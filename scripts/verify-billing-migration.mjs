// Read a user-owned SQL export into memory only; never print account data.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
const source=process.argv[2];if(!source)throw Error('Usage: node --experimental-sqlite scripts/verify-billing-migration.mjs <pre-0013-export.sql>');
const db=new DatabaseSync(':memory:');
try{
 db.exec(fs.readFileSync(source,'utf8'));
 const columns=db.prepare('PRAGMA table_info(accounts)').all();
 assert.ok(!columns.some(c=>c.name==='credit_remainder_micros'),'Expected pre-0014 export');
 const migrations=db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='d1_migrations'").get()?db.prepare('SELECT name FROM d1_migrations').all():[];
 assert.ok(!migrations.some(m=>m.name.startsWith('0013')),'Use the pre-0013 backup, not a migrated database');
 const before=db.prepare('SELECT id,credit_balance FROM accounts').all();
 db.exec(fs.readFileSync('worker/migrations/0013_credit_balance_cents.sql','utf8'));
 db.exec(fs.readFileSync('worker/migrations/0014_metered_models.sql','utf8'));
 for(const row of before){const after=db.prepare('SELECT credit_balance,credit_remainder_micros,billing_reserved_micros FROM accounts WHERE id=?').get(row.id);assert.equal(after.credit_balance,row.credit_balance*100);assert.equal(after.credit_remainder_micros,0);assert.equal(after.billing_reserved_micros,0);}
 assert.equal(db.prepare('PRAGMA foreign_key_check').all().length,0);
 console.log(JSON.stringify({ok:true,source:'pre-release export',migrations:['0013','0014'],accountsPreserved:true,foreignKeysValid:true,remoteWrites:false}));
}finally{db.close();}
