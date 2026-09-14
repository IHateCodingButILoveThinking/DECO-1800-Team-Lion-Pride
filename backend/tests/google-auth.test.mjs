import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync, readdirSync} from 'node:fs';
import {generateKeyPair, exportJWK, SignJWT} from 'jose';
import worker from '../src/worker.js';

const origin='https://deco1800teams-lion-pride.uqcloud.net';
const clientId='test-client.apps.googleusercontent.com';
const {privateKey,publicKey}=await generateKeyPair('RS256');
const jwk={...await exportJWK(publicKey),kid:'test-key',alg:'RS256',use:'sig'};
async function token(overrides={},key=privateKey){
  return new SignJWT({sub:'google-user-1',email:'neighbour@gmail.com',email_verified:true,name:'Test Neighbour',...overrides})
    .setProtectedHeader({alg:'RS256',kid:'test-key'}).setIssuer(overrides.iss||'https://accounts.google.com')
    .setAudience(overrides.aud||clientId).setIssuedAt().setExpirationTime(overrides.exp??'5m').sign(key);
}
function database(){
  const sqlite=new DatabaseSync(':memory:');sqlite.exec('PRAGMA foreign_keys=ON');
  for(const name of readdirSync(new URL('../migrations/',import.meta.url)).filter(name=>name.endsWith('.sql')).sort())sqlite.exec(readFileSync(new URL('../migrations/'+name,import.meta.url),'utf8'));
  return {sqlite,prepare(sql){return {bind(...args){const stmt=sqlite.prepare(sql);return {async first(){return stmt.get(...args)||null;},async all(){return {results:stmt.all(...args)};},async run(){return stmt.run(...args);}};}};}};
}
test('Google login and existing password accounts',async t=>{
  const realFetch=globalThis.fetch;
  globalThis.fetch=async url=>{assert.equal(String(url),'https://www.googleapis.com/oauth2/v3/certs');return Response.json({keys:[jwk]});};
  const db=database();const env={DB:db,GOOGLE_CLIENT_ID:clientId,ALLOWED_ORIGINS:origin};
  const request=(path,body,headers={})=>worker.fetch(new Request('https://api.example/api'+path,{method:'POST',headers:{Origin:origin,'Content-Type':'application/json',...headers},body:JSON.stringify(body)}),env);
  try{
    let session,id;
    await t.test('creates a password-free account and a valid session',async()=>{
      const response=await request('/auth/google',{credential:await token()});assert.equal(response.status,201);
      const result=await response.json();assert.equal(result.created,true);assert.equal(result.profile.name,'Test Neighbour');session=result.token;id=result.profile.id;
      const me=await worker.fetch(new Request('https://api.example/api/me',{headers:{Authorization:`Bearer ${session}`}}),env);
      assert.equal((await me.json()).profile.id,id);
      const row=db.sqlite.prepare('SELECT * FROM profiles WHERE id=?').get(id);assert.equal(row.password_hash,null);
      assert.equal(db.sqlite.prepare('SELECT id_hash FROM sessions').get().id_hash===session,false);
    });
    await t.test('repeat login uses stable Google subject even if email changes',async()=>{
      const response=await request('/auth/google',{credential:await token({email:'changed@gmail.com'})});assert.equal(response.status,200);assert.equal((await response.json()).profile.id,id);
      assert.equal(db.sqlite.prepare('SELECT COUNT(*) AS n FROM profiles').get().n,1);
    });
    await t.test('rejects bad signatures, audience, issuer, expiry and unverified emails',async()=>{
      const wrongKey=(await generateKeyPair('RS256')).privateKey;
      for(const credential of ['not-a-jwt',await token({aud:'another-client'}),await token({iss:'https://attacker.example'}),await token({exp:1}),await token({email_verified:false}),await token({},wrongKey)]){
        assert.equal((await request('/auth/google',{credential})).status,401);
      }
    });
    await t.test('rejects untrusted origins and non-JSON requests',async()=>{
      assert.equal((await request('/auth/google',{}, {Origin:'https://attacker.example'})).status,403);
      assert.equal((await request('/auth/google',{}, {'Content-Type':'text/plain'})).status,415);
    });
    await t.test('verified Gmail login connects to the matching password profile',async()=>{
      const credentials={email:'existing@gmail.com',password:'a-long-test-password'};
      const registered=await request('/auth/register',{...credentials,name:'Existing Neighbour',suburb:'New Farm'});
      assert.equal(registered.status,201);const original=(await registered.json()).profile;
      assert.equal((await request('/auth/login',credentials)).status,200);
      const connected=await request('/auth/google',{credential:await token({sub:'another-google-user',email:credentials.email})});
      assert.equal(connected.status,200);const result=await connected.json();
      assert.equal(result.profile.id,original.id);assert.equal(result.profile.name,'Existing Neighbour');
      assert.equal((await request('/auth/login',credentials)).status,200);
    });
    await t.test('does not merge a non-Google-hosted email by address alone',async()=>{
      const credentials={email:'existing@example.com',password:'a-long-test-password'};
      assert.equal((await request('/auth/register',{...credentials,name:'Other Neighbour',suburb:'West End'})).status,201);
      assert.equal((await request('/auth/google',{credential:await token({sub:'custom-email-user',email:credentials.email})})).status,409);
    });
    await t.test('logout invalidates the Google-created session',async()=>{
      assert.equal((await request('/auth/logout',{}, {Authorization:`Bearer ${session}`})).status,200);
      const me=await worker.fetch(new Request('https://api.example/api/me',{headers:{Authorization:`Bearer ${session}`}}),env);
      assert.equal((await me.json()).signedIn,false);
    });
  }finally{globalThis.fetch=realFetch;db.sqlite.close();}
});
