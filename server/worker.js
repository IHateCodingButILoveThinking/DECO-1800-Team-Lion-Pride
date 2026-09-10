/* Plain JavaScript Worker. Sites supplies trusted authentication headers and DB.
   staticAssets is injected by build.js; the browser never receives server code. */
const json = (data, status=200) => Response.json(data,{status,headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
class HttpError extends Error { constructor(status,message){super(message);this.status=status;} }
const fail = (status,message) => {throw new HttpError(status,message);};
const text = (value,name,max,required=true) => {if(typeof value!=='string') {if(!required && value==null)return '';fail(400,`${name} must be text.`);} const clean=value.trim();if((required&&!clean)||clean.length>max)fail(400,`${name} must be ${required?'1':'0'}–${max} characters.`);return clean;};
const list = (value,name) => {if(!Array.isArray(value)||value.length>12||value.some(v=>typeof v!=='string'||!v.trim()||v.length>45))fail(400,`Choose valid ${name}.`);return JSON.stringify([...new Set(value.map(v=>v.trim()))]);};
function safeLink(value,facebook=false){const link=text(value,'Link',1500,false);if(!link)return '';let url;try{url=new URL(link);}catch{fail(400,'Enter a complete https:// link.');}if(url.protocol!=='https:'||url.username||url.password)fail(400,'Links must use https://.');if(facebook&&!['facebook.com','www.facebook.com','m.facebook.com','fb.com','www.fb.com','messenger.com','www.messenger.com','m.me'].includes(url.hostname))fail(400,'Use a Facebook group or Messenger link.');return url.href;}
function parseProfile(row,own=false){if(!row)return null;return {id:row.id,name:row.name,suburb:own||row.show_suburb?row.suburb:'',bio:row.bio,interests:own||row.show_interests?JSON.parse(row.interests):[],ages:own?JSON.parse(row.ages):[],...(own?{email:row.email,showSuburb:!!row.show_suburb,showInterests:!!row.show_interests}:{}),createdAt:row.created_at};}
function identity(request,env){const host=new URL(request.url).hostname;if(env.LOCAL_DEV==='true'&&['localhost','127.0.0.1'].includes(host))return {id:request.headers.get('x-local-user')||'local-family-finds',email:'local@familyfinds.test'};const id=request.headers.get('oai-authenticated-user-id');return id?{id,email:request.headers.get('oai-authenticated-user-email')||''}:null;}
const all = async (db,sql,...args)=>(await db.prepare(sql).bind(...args).all()).results;
const first = (db,sql,...args)=>db.prepare(sql).bind(...args).first();
const run = (db,sql,...args)=>db.prepare(sql).bind(...args).run();
async function bodyOf(request){const raw=await request.text();if(raw.length>24000)fail(413,'This entry is too large.');try{return JSON.parse(raw);}catch{fail(400,'Invalid request.');}}
async function member(db,clubId,userId){return userId?first(db,'SELECT user_id FROM memberships WHERE club_id=? AND user_id=?',clubId,userId):null;}
async function clubById(db,id,userId){const club=await first(db,`SELECT c.*,p.name AS owner_name,(SELECT COUNT(*) FROM memberships m WHERE m.club_id=c.id) AS member_count FROM clubs c JOIN profiles p ON p.id=c.owner_id WHERE c.id=?`,id);if(!club)fail(404,'This club could not be found.');return {...club,interests:JSON.parse(club.interests),ages:JSON.parse(club.ages),joined:!!await member(db,id,userId),isOwner:club.owner_id===userId};}
async function requirePost(db,id,user){const post=await first(db,'SELECT * FROM posts WHERE id=?',id);if(!post)fail(404,'This discussion could not be found.');if(post.club_id&&!await member(db,post.club_id,user?.id))fail(403,'Join this club to read and reply to its discussions.');return post;}
async function postRows(db,clubId,userId){return all(db,`SELECT p.*,u.name AS author,u.show_suburb,u.suburb,c.name AS club_name,(SELECT COUNT(*) FROM replies r WHERE r.post_id=p.id) AS reply_count,(SELECT COUNT(*) FROM reactions r WHERE r.post_id=p.id) AS helpful_count,EXISTS(SELECT 1 FROM reactions r WHERE r.post_id=p.id AND r.user_id=?) AS liked FROM posts p JOIN profiles u ON u.id=p.author_id LEFT JOIN clubs c ON c.id=p.club_id WHERE ${clubId?'p.club_id=?':'p.club_id IS NULL'} ORDER BY p.created_at DESC LIMIT 100`,...clubId?[userId||'',clubId]:[userId||'']);}
function publicPosts(rows){return rows.map(row=>({...row,suburb:row.show_suburb?row.suburb:'',show_suburb:undefined}));}
export default {
 async fetch(request,env){
  const url=new URL(request.url);
  try{
   if(!url.pathname.startsWith('/api/')){
    const key=url.pathname==='/'?'/index.html':url.pathname;
    const asset=staticAssets[key];
    if(!asset)return new Response('Not found',{status:404});
    const data=asset.binary?Uint8Array.from(atob(asset.body),c=>c.charCodeAt(0)):asset.body;
    return new Response(data,{headers:{'Content-Type':asset.type,'Cache-Control':key==='/index.html'?'no-cache':'public, max-age=300','X-Content-Type-Options':'nosniff','Referrer-Policy':'strict-origin-when-cross-origin'}});
   }
   const db=env.DB;if(!db)fail(503,'Community is temporarily unavailable. Please try again shortly.');
   const auth=identity(request,env);
   const user=auth?await first(db,'SELECT * FROM profiles WHERE auth_id=?',auth.id):null;
   const path=url.pathname; const method=request.method;
   if(!['GET','HEAD'].includes(method)){
    if(request.headers.get('Origin')!==url.origin)fail(403,'Please submit this request from Family Finds.');
    if(!auth)fail(401,'Sign in to continue.');
   }
   const requireUser=()=>{if(!auth)fail(401,'Sign in to continue.');if(!user)fail(409,'Create your Family Finds profile first.');return user;};
   if(path==='/api/me'&&method==='GET')return json({signedIn:!!auth,email:auth?.email||'',profile:parseProfile(user,true)});
   if(path==='/api/profile'&&method==='POST'){
    const body=await bodyOf(request);if(user)fail(409,'Your profile already exists.');
    const id=crypto.randomUUID();await run(db,'INSERT INTO profiles (id,auth_id,email,name,suburb,bio,interests,ages,created_at) VALUES (?,?,?,?,?,?,?,?,?)',id,auth.id,auth.email,text(body.name,'Name',60),text(body.suburb,'Suburb',60),text(body.bio,'Bio',500,false),list(body.interests||[],'interests'),list(body.ages||[],'age groups'),Date.now());return json({profile:parseProfile(await first(db,'SELECT * FROM profiles WHERE id=?',id),true)},201);
   }
   if(path==='/api/profile'&&method==='PATCH'){
    requireUser();const body=await bodyOf(request);
    await run(db,'UPDATE profiles SET name=?,suburb=?,bio=?,interests=?,ages=?,show_suburb=?,show_interests=? WHERE id=?',text(body.name??user.name,'Name',60),text(body.suburb??user.suburb,'Suburb',60),text(body.bio??user.bio,'Bio',500,false),list(body.interests??JSON.parse(user.interests),'interests'),list(body.ages??JSON.parse(user.ages),'age groups'),body.showSuburb===undefined?user.show_suburb:Number(body.showSuburb===true),body.showInterests===undefined?user.show_interests:Number(body.showInterests===true),user.id);
    return json({profile:parseProfile(await first(db,'SELECT * FROM profiles WHERE id=?',user.id),true)});
   }
   if(path.startsWith('/api/profiles/')&&method==='GET'){
    requireUser();const id=decodeURIComponent(path.slice('/api/profiles/'.length));const profile=await first(db,'SELECT * FROM profiles WHERE id=?',id);if(!profile)fail(404,'Member not found.');
    return json({profile:parseProfile(profile,id===user.id),clubs:await all(db,'SELECT c.id,c.name,c.suburb,c.color FROM clubs c JOIN memberships m ON m.club_id=c.id WHERE m.user_id=? ORDER BY c.name',id)});
   }
   if(path==='/api/clubs'&&method==='GET'){
    const clubs=await all(db,`SELECT c.*,p.name AS owner_name,(SELECT COUNT(*) FROM memberships m WHERE m.club_id=c.id) AS member_count,EXISTS(SELECT 1 FROM memberships m WHERE m.club_id=c.id AND m.user_id=?) AS joined FROM clubs c JOIN profiles p ON p.id=c.owner_id ORDER BY c.created_at DESC LIMIT 200`,user?.id||'');
    return json({clubs:clubs.map(c=>({...c,interests:JSON.parse(c.interests),ages:JSON.parse(c.ages),joined:!!c.joined,isOwner:c.owner_id===user?.id}))});
   }
   if(path==='/api/clubs'&&method==='POST'){
    requireUser();const b=await bodyOf(request);const id=crypto.randomUUID();const color=['blue','green','purple','orange'].includes(b.color)?b.color:'blue';
    await db.batch([db.prepare('INSERT INTO clubs (id,owner_id,name,suburb,description,interests,ages,facebook_url,color,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)').bind(id,user.id,text(b.name,'Club name',80),text(b.suburb,'Suburb',60),text(b.description,'Description',1000),list(b.interests||[],'interests'),list(b.ages||[],'age groups'),safeLink(b.facebookUrl,true),color,Date.now()),db.prepare('INSERT INTO memberships (club_id,user_id,created_at) VALUES (?,?,?)').bind(id,user.id,Date.now())]);return json({club:await clubById(db,id,user.id)},201);
   }
   const clubMatch=path.match(/^\/api\/clubs\/([^/]+)(?:\/(members|membership))?$/);
   if(clubMatch){
    const id=clubMatch[1], action=clubMatch[2];const club=await clubById(db,id,user?.id);
    if(!action&&method==='GET')return json({club,posts:club.joined?publicPosts(await postRows(db,id,user.id)):[]});
    if(!action&&method==='PATCH'){
     requireUser();if(!club.isOwner)fail(403,'Only the club owner can edit this club.');const b=await bodyOf(request);
     await run(db,'UPDATE clubs SET name=?,suburb=?,description=?,interests=?,ages=?,facebook_url=?,color=? WHERE id=?',text(b.name,'Club name',80),text(b.suburb,'Suburb',60),text(b.description,'Description',1000),list(b.interests||[],'interests'),list(b.ages||[],'age groups'),safeLink(b.facebookUrl,true),['blue','green','purple','orange'].includes(b.color)?b.color:'blue',id);return json({club:await clubById(db,id,user.id)});
    }
    if(action==='membership'&&method==='POST'){requireUser();await run(db,'INSERT OR IGNORE INTO memberships (club_id,user_id,created_at) VALUES (?,?,?)',id,user.id,Date.now());return json({club:await clubById(db,id,user.id)});}
    if(action==='membership'&&method==='DELETE'){requireUser();if(club.isOwner)fail(409,'Club owners must stay in their club.');await run(db,'DELETE FROM memberships WHERE club_id=? AND user_id=?',id,user.id);return json({club:await clubById(db,id,user.id)});}
    if(action==='members'&&method==='GET'){requireUser();if(!club.joined)fail(403,'Join this club to see its members.');const rows=await all(db,'SELECT p.* FROM profiles p JOIN memberships m ON m.user_id=p.id WHERE m.club_id=? ORDER BY m.created_at',id);return json({members:rows.map(p=>({...parseProfile(p),isOwner:p.id===club.owner_id}))});}
   }
   if(path==='/api/posts'&&method==='GET')return json({posts:publicPosts(await postRows(db,null,user?.id))});
   if(path==='/api/posts'&&method==='POST'){
    requireUser();const b=await bodyOf(request);const clubId=b.clubId?text(b.clubId,'Club',80):null;if(clubId&&!await member(db,clubId,user.id))fail(403,'Join this club before posting.');const topics=['Meetups','Local tips','Swap & share','Ask for help'];if(!topics.includes(b.topic))fail(400,'Choose a discussion topic.');
    const id=crypto.randomUUID();await run(db,'INSERT INTO posts (id,author_id,club_id,title,body,topic,link,created_at) VALUES (?,?,?,?,?,?,?,?)',id,user.id,clubId,text(b.title,'Title',120),text(b.body,'Message',4000),b.topic,safeLink(b.link),Date.now());return json({id},201);
   }
   const postMatch=path.match(/^\/api\/posts\/([^/]+)(?:\/(replies|helpful))?$/);
   if(postMatch){
    const id=postMatch[1],action=postMatch[2];const post=await requirePost(db,id,user);
    if(!action&&method==='GET'){const author=await first(db,'SELECT * FROM profiles WHERE id=?',post.author_id);const replies=await all(db,'SELECT r.*,p.name AS author FROM replies r JOIN profiles p ON p.id=r.author_id WHERE r.post_id=? ORDER BY r.created_at ASC',id);return json({post:{...post,author:author.name},replies});}
    if(!action&&method==='DELETE'){requireUser();const owner=post.club_id?await first(db,'SELECT owner_id FROM clubs WHERE id=?',post.club_id):null;if(post.author_id!==user.id&&owner?.owner_id!==user.id)fail(403,'Only the author or club owner can remove this discussion.');await run(db,'DELETE FROM posts WHERE id=?',id);return json({deleted:true});}
    if(action==='replies'&&method==='POST'){requireUser();const b=await bodyOf(request);await run(db,'INSERT INTO replies (id,post_id,author_id,body,created_at) VALUES (?,?,?,?,?)',crypto.randomUUID(),id,user.id,text(b.body,'Reply',2000),Date.now());return json({created:true},201);}
    if(action==='helpful'&&method==='POST'){requireUser();await run(db,'INSERT OR IGNORE INTO reactions (post_id,user_id) VALUES (?,?)',id,user.id);return json({helpful:true});}
    if(action==='helpful'&&method==='DELETE'){requireUser();await run(db,'DELETE FROM reactions WHERE post_id=? AND user_id=?',id,user.id);return json({helpful:false});}
   }
   if(path==='/api/saved'&&method==='GET'){requireUser();const rows=await all(db,'SELECT event_json FROM saved WHERE user_id=? ORDER BY created_at DESC',user.id);return json({events:rows.map(row=>JSON.parse(row.event_json))});}
   if(path==='/api/saved'&&method==='POST'){requireUser();const b=await bodyOf(request);if(!b.event||typeof b.event!=='object')fail(400,'Choose an activity.');const id=text(b.event.id,'Event',2000);text(b.event.title,'Event title',300);if(JSON.stringify(b.event).length>14000)fail(400,'Event details are too long.');await run(db,'INSERT INTO saved (user_id,event_id,event_json,created_at) VALUES (?,?,?,?) ON CONFLICT(user_id,event_id) DO UPDATE SET event_json=excluded.event_json',user.id,id,JSON.stringify(b.event),Date.now());return json({saved:true});}
   if(path==='/api/saved'&&method==='DELETE'){requireUser();const b=await bodyOf(request);await run(db,'DELETE FROM saved WHERE user_id=? AND event_id=?',user.id,text(b.id,'Event',2000));return json({saved:false});}
   if(path==='/api/event-interest'&&method==='GET'){
    if(!user)return json({events:{}});
    const own=await all(db,'SELECT event_id FROM event_interest WHERE user_id=?',user.id);
    const shared=await all(db,`SELECT ei.event_id,p.id AS user_id,p.name,c.id AS club_id,c.name AS club_name
      FROM event_interest ei
      JOIN profiles p ON p.id=ei.user_id
      JOIN memberships theirs ON theirs.user_id=ei.user_id
      JOIN memberships mine ON mine.club_id=theirs.club_id AND mine.user_id=?
      JOIN clubs c ON c.id=mine.club_id
      WHERE ei.user_id<>?
      ORDER BY ei.created_at DESC LIMIT 2000`,user.id,user.id);
    const events={};
    for(const row of own)events[row.event_id]={interested:true,people:[],count:0,clubs:[]};
    for(const row of shared){
      const entry=events[row.event_id]||(events[row.event_id]={interested:false,people:[],count:0,clubs:[]});
      if(!entry.people.some(person=>person.id===row.user_id)){entry.people.push({id:row.user_id,name:row.name});entry.count++;}
      if(!entry.clubs.some(item=>item.id===row.club_id))entry.clubs.push({id:row.club_id,name:row.club_name});
    }
    for(const entry of Object.values(events))entry.people=entry.people.slice(0,3);
    return json({events});
   }
   if(path==='/api/event-interest'&&method==='POST'){
    requireUser();const b=await bodyOf(request);if(!b.event||typeof b.event!=='object')fail(400,'Choose an activity.');
    const id=text(b.event.id,'Event',2000);text(b.event.title,'Event title',300);if(JSON.stringify(b.event).length>14000)fail(400,'Event details are too long.');
    await run(db,'INSERT INTO event_interest (user_id,event_id,event_json,created_at) VALUES (?,?,?,?) ON CONFLICT(user_id,event_id) DO UPDATE SET event_json=excluded.event_json,created_at=excluded.created_at',user.id,id,JSON.stringify(b.event),Date.now());
    return json({interested:true});
   }
   if(path==='/api/event-interest'&&method==='DELETE'){
    requireUser();const b=await bodyOf(request);await run(db,'DELETE FROM event_interest WHERE user_id=? AND event_id=?',user.id,text(b.id,'Event',2000));return json({interested:false});
   }
   return json({error:'This endpoint was not found.'},404);
  }catch(error){if(!(error instanceof HttpError))console.error('Family Finds API error:',error.message);return json({error:error instanceof HttpError?error.message:'Something went wrong. Please try again.'},error.status||500);}
 }
};
