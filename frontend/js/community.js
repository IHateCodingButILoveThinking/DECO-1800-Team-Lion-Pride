/* Clubs, profiles and discussions use the same server API on every device. */
const Social = (() => {
  const interests = ['Outdoor play', 'Arts & crafts', 'Books & stories', 'Sports & movement', 'Nature & gardening', 'Markets & swaps', 'Weekend adventures', 'Parent support'];
  const ageGroups = ['0–3 years', '4–7 years', '8–12 years', 'Teens', 'All ages'];
  const topics = ['Meetups', 'Local tips', 'Swap & share', 'Ask for help'];
  const demoClubs = [
    {id:'weekend-explorers',name:'Weekend Explorers',suburb:'West End',color:'green',glyph:'leaf',interests:['Outdoor play','Weekend adventures'],description:'A draft club for families who want relaxed walks, parks and weekend play dates.',plan:'Start with a Saturday park meetup and a shared list of favourite free places.'},
    {id:'little-makers',name:'Little Makers',suburb:'Indooroopilly',color:'purple',glyph:'art',interests:['Arts & crafts','Books & stories'],description:'A draft space to swap creative ideas and plan low-cost making sessions.',plan:'Meet at a local library, bring simple materials and share ideas in a club discussion.'},
    {id:'market-mates',name:'Market Mates',suburb:'Wynnum',color:'orange',glyph:'people',interests:['Markets & swaps','Parent support'],description:'A draft club for families browsing markets, swaps and local finds together.',plan:'Share a market event and agree on a public meeting point before visiting.'}
  ];
  let me = null, ready = false, connectionError = '', clubs = [], discussions = [], club = null, members = [], joinRequests = [], blockedMembers = [], interestByEvent = {};
  let clubApprovalAvailable = null;
  let section = 'discover', clubTab = 'discussions', search = '', suburb = '', interest = '', topic = '', filtersOpen = false;
  let requestVersion = 0;
  const apiOrigin = String(window.FAMILY_FINDS_CONFIG?.apiOrigin || '').replace(/\/$/, '');
  const sessionKey = 'family_finds_session';
  const e = value => escapeHTML(value);
  // Keep a useful offline list; Council event locations add more suggestions when available.
  const suburbSuggestions = new Set([
    'Ascot', 'Ashgrove', 'Balmoral', 'Brisbane City', 'Bulimba', 'Camp Hill',
    'Carina', 'Chermside', 'Coorparoo', 'Darra', 'East Brisbane', 'Eight Mile Plains',
    'Everton Park', 'Fortitude Valley', 'Graceville', 'Hamilton', 'Highgate Hill',
    'Indooroopilly', 'Kangaroo Point', 'Kelvin Grove', 'Kenmore', 'Manly',
    'Milton', 'Moorooka', 'Mount Gravatt', 'New Farm', 'Newmarket', 'Nundah',
    'Paddington', 'Red Hill', 'Rochedale', 'St Lucia', 'South Brisbane',
    'Spring Hill', 'Stafford', 'Sunnybank', 'Taringa', 'Tarragindi', 'Toowong',
    'Upper Mount Gravatt', 'West End', 'Woolloongabba', 'Wynnum', 'Yeronga'
  ]);
  let suburbSuggestionsRequest;
  function formatSuburb(value) {
    const name = String(value || '').normalize('NFKC').replace(/\s+/g, ' ')
      .replace(/(?:,?\s+(?:QLD|Queensland))?(?:\s+\d{4})$/i, '')
      .replace(/,?\s+(?:QLD|Queensland)$/i, '').trim();
    if (!name) return '';
    const known = [...suburbSuggestions].find(item => item.toLocaleLowerCase('en-AU') === name.toLocaleLowerCase('en-AU'));
    return known || name.replace(/\p{L}+/gu, word => word[0].toLocaleUpperCase('en-AU') + word.slice(1).toLocaleLowerCase('en-AU'));
  }
  function updateSuburbLists() {
    const values = [...suburbSuggestions].sort((a, b) => a.localeCompare(b, 'en-AU'));
    document.querySelectorAll('datalist[data-suburb-options]').forEach(list => {
      list.replaceChildren(...values.map(value => {
        const option = document.createElement('option');
        option.value = value;
        return option;
      }));
    });
  }
  function attachSuburbList(input) {
    if (!input.list) {
      const list = document.createElement('datalist');
      list.id = `${input.id}-suggestions`;
      list.dataset.suburbOptions = '';
      input.after(list);
      input.setAttribute('list', list.id);
    }
    if (profile()?.suburb) suburbSuggestions.add(formatSuburb(profile().suburb));
    clubs.forEach(item => { if (item.suburb) suburbSuggestions.add(formatSuburb(item.suburb)); });
    updateSuburbLists();
    if (!suburbSuggestionsRequest) {
      suburbSuggestionsRequest = CouncilEvents.loadSuburbs().then(values => {
        values.forEach(value => {
          const name = formatSuburb(value);
          if (/^[\p{L}][\p{L}\s'-]{1,58}$/u.test(name)) suburbSuggestions.add(name);
        });
        updateSuburbLists();
      }).catch(() => { suburbSuggestionsRequest = null; });
    }
  }
  const initials = name => String(name || '').split(/\s+/).filter(Boolean).slice(0,2).map(word => word[0]).join('').toUpperCase();
  const ago = value => { const mins = Math.max(0,Math.floor((Date.now()-value)/60000)); return mins<1?'Just now':mins<60?`${mins}m ago`:mins<1440?`${Math.floor(mins/60)}h ago`:new Date(value).toLocaleDateString('en-AU',{day:'numeric',month:'short',timeZone:'Australia/Brisbane'}); };
  async function api(path, options={}) {
    const token=localStorage.getItem(sessionKey);
    const response = await fetch(`${apiOrigin}/api${path}`,{...options,credentials:'include',headers:{'Content-Type':'application/json',...(token?{Authorization:`Bearer ${token}`} : {}),...options.headers},signal:AbortSignal.timeout(20000)});
    let data;try{data=await response.json();}catch{throw new Error('The community connection is unavailable. Please try again shortly.');}
    if(!response.ok){const error=new Error(data.error||'Something went wrong.');error.status=response.status;throw error;}
    return data;
  }
  async function clubServerReady(){
    if(clubApprovalAvailable!==null)return clubApprovalAvailable;
    const health=await api('/health');
    clubApprovalAvailable=health.features?.clubApproval===true;
    return clubApprovalAvailable;
  }
  let googleLibrary, googleInitialized = false, googleBusy = false;
  function loadGoogleLibrary() {
    if(window.google?.accounts?.id)return Promise.resolve();
    if(googleLibrary)return googleLibrary;
    googleLibrary=new Promise((resolve,reject)=>{
      const script=document.createElement('script');
      const timeout=setTimeout(()=>finish(new Error('Google sign-in took too long to load.')),12000);
      function finish(error){clearTimeout(timeout);script.onload=null;script.onerror=null;if(error){script.remove();googleLibrary=null;reject(error);}else resolve();}
      script.src='https://accounts.google.com/gsi/client';script.async=true;
      script.onload=()=>finish(window.google?.accounts?.id?null:new Error('Google sign-in is unavailable.'));
      script.onerror=()=>finish(new Error('Google sign-in could not load.'));
      document.head.append(script);
    });
    return googleLibrary;
  }
  async function mountGoogleButton() {
    const container=document.querySelector('#google-signin');
    const status=document.querySelector('#google-signin-status');
    if(!container||!status)return;
    try {
      await loadGoogleLibrary();
      if(!container.isConnected)return;
      const clientId=window.FAMILY_FINDS_CONFIG?.googleClientId;
      if(!clientId)throw new Error('Google sign-in is unavailable.');
      if(!googleInitialized){
        window.google.accounts.id.initialize({client_id:clientId,callback:completeGoogleSignIn,auto_select:false,ux_mode:'popup'});
        googleInitialized=true;
      }
      window.google.accounts.id.renderButton(container,{type:'standard',theme:'outline',size:'large',text:'continue_with',shape:'pill',width:Math.min(400,Math.floor(container.getBoundingClientRect().width))});
      status.textContent='Use your Google account to join or log in.';
    }catch(error){
      if(!container.isConnected)return;
      status.textContent=error.message+' You can still use email and password.';
      const retry=document.createElement('button');retry.type='button';retry.className='button';retry.textContent='Retry Google sign-in';
      retry.addEventListener('click',()=>{container.replaceChildren();status.textContent='Loading Google sign-in…';mountGoogleButton();});
      container.replaceChildren(retry);
    }
  }
  async function completeGoogleSignIn(response) {
    if(googleBusy||profile())return;
    googleBusy=true;
    const status=document.querySelector('#google-signin-status');
    if(status)status.textContent='Signing you in…';
    try {
      if(!response.credential)throw new Error('Google did not return a login. Please try again.');
      const result=await api('/auth/google',{method:'POST',body:JSON.stringify({credential:response.credential})});
      localStorage.setItem(sessionKey,result.token);
      me={signedIn:true,email:result.profile.email,profile:result.profile};saved=[];interestByEvent={};
      // A saved-activities outage must not undo a successful sign-in.
      try{const data=await api('/saved');saved=data.events;await refreshEventInterest();}catch{notify('Signed in. Saved activities could not be loaded yet.');}
      updateCount();accountHeader();
      notify(result.created?'Welcome! You can add your suburb and interests in Edit profile.':'Welcome back.');
      navigate(result.created?'edit-profile':'community');
    }catch(error){if(status?.isConnected)status.textContent=error.message;else notify(error.message);}
    finally{googleBusy=false;}
  }
  function profile(){return me?.profile;}
  function requireProfile(){if(!ready||connectionError){notify('The account connection is unavailable. Please try again.');return false;}if(!profile()){navigate(me?.signedIn?'register':'login');return false;}return true;}
  function accountHeader(){const node=document.querySelector('#header-account');if(!node)return;node.innerHTML=profile()?`<a href="#profile" class="account-name">${e(profile().name)}</a><a href="#settings" class="account-settings-link" aria-label="Account settings" title="Account settings">${icon('settings',18)}</a><details><summary class="account-avatar" aria-label="Open account menu">${e(initials(profile().name))}</summary><div class="account-menu"><a href="#profile">My profile</a><a href="#settings">Account settings</a><a href="#edit-profile">Edit profile</a><button class="plain-button account-logout" data-social="logout">Log out</button></div></details>`:'<a href="#login">Log in</a><a class="button primary header-register" href="#register">Join Family Finds</a>';}
  async function refreshEventInterest(){
    if(!profile()){interestByEvent={};return;}
    const data=await api('/event-interest');interestByEvent=data.events||{};
  }
  async function init(){try{me=await api('/me');connectionError='';if(profile()){const [savedData]=await Promise.all([api('/saved'),refreshEventInterest()]);saved=savedData.events;updateCount();}}catch(error){localStorage.removeItem(sessionKey);connectionError=error.message;}finally{ready=true;accountHeader();render();}}
  function interestCopy(entry){
    if(!entry?.count)return '';
    const first=entry.people[0]?.name||'A club member';
    const people=entry.count===1?first:`${first} + ${entry.count-1}`;
    const clubName=entry.clubs[0]?.name||'one of your clubs';
    return `<strong>${e(people)}</strong> from ${e(clubName)} ${entry.count===1?'is':'are'} interested`;
  }
  function interestAvatars(entry){return entry?.people?.length?`<span class="interest-avatars">${entry.people.map(person=>`<span class="interest-avatar" title="${e(person.name)}">${e(initials(person.name))}</span>`).join('')}</span>`:'';}
  function eventInterestDetail(id){
    if(!profile())return '';
    const entry=interestByEvent[id]||{interested:false,people:[],count:0,clubs:[]};
    return `<section class="event-club-interest"><h3>Share interest with your clubs</h3><p class="subtle">Let people in your Family Finds clubs know you may go. This does not reserve a place; use the booking option if one is required.</p><div class="interest-summary"><div class="club-interest">${interestAvatars(entry)}<span class="club-interest-copy">${entry.count?interestCopy(entry):entry.interested?'You’ve shared your interest with your clubs.':'No one from your clubs has shown interest yet.'}</span></div><button class="button ${entry.interested?'soft':'primary'}" data-event-interest="${e(id)}" aria-pressed="${entry.interested}">${entry.interested?`${icon('check',15)} Remove interest`:'Tell my clubs I’m interested'}</button></div></section>`;
  }
  async function toggleEventInterest(id){
    if(!requireProfile())return;
    const event=findEvent(id);if(!event)return;
    const interested=!!interestByEvent[id]?.interested;
    try{
      await api('/event-interest',{method:interested?'DELETE':'POST',body:JSON.stringify(interested?{id}:{event})});
      await refreshEventInterest();
      notify(interested?'Interest removed.':'You’re interested. People in your clubs can now see this.');
      renderEventResults();
      if(modal.open&&modal.dataset.eventId===id)showEvent(id);
    }catch(error){notify(error.message);}
  }
  function spinner(){return '<div class="loading-panel"><span class="loading-dot"></span> Getting everything ready…</div>';}
  function errorPanel(message){return `<div class="empty-state"><div class="empty-icon">${icon('people',36)}</div><h3>Let’s try that again.</h3><p>${e(message)}</p><button class="button" data-social="retry">Try again</button></div>`;}
  function handles(route){return ['community','club','login','register','profile','settings','edit-profile','member','post'].includes(route);}
  async function show(route){
    const version=++requestVersion;
    if(['login','register'].includes(route)){main.innerHTML=authPage(route);return;}
    if(!ready){main.innerHTML=spinner();return;}
    if(connectionError){main.innerHTML=route==='community'?demoOffline():errorPanel(connectionError);return;}
    if(route==='settings'||route==='edit-profile'){
      if(!profile()){main.innerHTML=authPage('login');return;}
      main.innerHTML=route==='settings'?settingsPage():editProfilePage();
      return;
    }
    main.innerHTML=spinner();
    try{
      if(route==='community'){
        const [c,p]=await Promise.all([api('/clubs'),api('/posts')]);if(version!==requestVersion)return;clubs=c.clubs;discussions=p.posts;paintCommunity();
      }else if(route==='club'){
        const id=location.hash.split('/')[1];const data=await api(`/clubs/${encodeURIComponent(id)}`);if(version!==requestVersion)return;if(club?.id!==data.club.id)clubTab='discussions';club=data.club;discussions=data.posts;members=[];joinRequests=[];blockedMembers=[];
        if(club.joined){const data=await api(`/clubs/${club.id}/members`);if(version!==requestVersion)return;members=data.members;}
        if(club.isOwner){const [requests,blocks]=await Promise.allSettled([api(`/clubs/${club.id}/requests`),api(`/clubs/${club.id}/blocks`)]);if(version!==requestVersion)return;joinRequests=requests.status==='fulfilled'?requests.value.requests:[];blockedMembers=blocks.status==='fulfilled'?blocks.value.members:[];}
        main.innerHTML=clubPage();
      }else if(route==='profile'||route==='member'){
        if(!profile()){main.innerHTML=authPage('login');return;}
        const id=route==='member'?location.hash.split('/')[1]:profile().id;const [data,c]=await Promise.all([api(`/profiles/${encodeURIComponent(id)}`),api('/clubs')]);if(version!==requestVersion)return;clubs=c.clubs;main.innerHTML=profilePage(data,route==='profile');
      }else if(route==='post'){
        const data=await api(`/posts/${encodeURIComponent(location.hash.split('/')[1])}`);if(version!==requestVersion)return;main.innerHTML=postPage(data);
      }
    }catch(error){if(version===requestVersion)main.innerHTML=route==='community'?demoOffline():errorPanel(error.message);}
  }
  function demoSection(){return `<section class="demo-community-section" aria-label="Draft community previews"><div class="demo-community-heading"><div><span class="sidebar-kicker">TRADESHOW PREVIEW</span><h2>Club ideas</h2><p>Examples only · no members yet</p></div></div><div class="club-grid demo-club-grid">${demoClubs.map(c=>`<article class="club-card demo-club-card"><div class="club-cover ${c.color}"><span class="club-glyph">${icon(c.glyph,29)}</span><span class="club-location">${icon('pin',13)} ${e(c.suburb)}</span></div><div class="club-body"><span class="demo-label">Draft club</span><h3>${e(c.name)}</h3><p>${e(c.description)}</p><div class="club-tags">${c.interests.map(i=>`<span class="tag">${e(i)}</span>`).join('')}</div><button class="button small" data-demo-club="${e(c.id)}">Preview setup ${icon('arrow',14)}</button></div></article>`).join('')}</div></section>`;}
  function demoOffline(){return `<section class="page-heading community-hero"><div><div class="eyebrow">BRISBANE COMMUNITY</div><h1>Find your people close to home.</h1><p class="intro">Explore how neighbourhood clubs could look.</p></div></section><p class="inline-notice">Live community data is unavailable right now. The draft previews below still show the tradeshow setup.</p>${demoSection()}`;}
  function pageHeader(){return `<section class="page-heading community-hero"><h1>${section==='discover'?'Find a family club':section==='mine'?'My clubs':'Discussions'}</h1>${section==='discover'||section==='mine'&&profile()?`<button class="button primary" data-social="create-club">${icon('plus',16)} Start a club</button>`:''}</section>`;}
  function communityChrome(){
    const suburbOptions=[...new Set(clubs.map(c=>c.suburb))].sort().map(s=>`<option value="${e(s)}" ${s===suburb?'selected':''}>${e(s)}</option>`).join('');
    const filters=Number(!!suburb)+Number(!!interest);
    const searchBar=section==='mine'&&!profile()?'':`<div class="community-search-bar"><label class="search-field"><span>${icon('search',18)}</span><input type="search" id="club-search" placeholder="${section==='discussions'?'Search discussions':'Search clubs or places'}" aria-label="Search community" value="${e(search)}"></label>${section==='discover'?`<button class="button community-filter-toggle" type="button" data-community-filters aria-expanded="${filtersOpen}" aria-controls="community-filter-panel">${icon('filters',16)} Filters${filters?` <span class="filter-count">${filters}</span>`:''}</button>`:''}</div>`;
    const filterPanel=section==='discover'?`<div class="community-filter-panel" id="community-filter-panel" ${filtersOpen?'':'hidden'}><label for="club-suburb">Suburb</label><select id="club-suburb" aria-label="Filter clubs by suburb"><option value="">All suburbs</option>${suburbOptions}</select><span class="community-filter-label">Interest</span><div class="community-interest-filter" aria-label="Filter by interest"><button class="tag interest-tag ${!interest?'selected':''}" data-interest="">All</button>${interests.map(i=>`<button class="tag interest-tag ${interest===i?'selected':''}" data-interest="${e(i)}">${e(i)}</button>`).join('')}</div>${filters?'<button class="plain-button community-clear-filters" data-clear-community-filters>Clear filters</button>':''}</div>`:'';
    const tabs=[['discover','Clubs'],['discussions','Discussions'],...(profile()?[['mine','My clubs']]:[])];
    return `${pageHeader()}<div class="community-navigation"><div class="section-tabs" role="group" aria-label="Community sections">${tabs.map(([id,label])=>`<button class="${section===id?'active':''}" data-community-section="${id}" aria-pressed="${section===id}">${label}</button>`).join('')}</div><button class="community-rules-link" type="button" data-community-rules>${icon('shield',16)} Rules</button></div><div class="community-discover">${searchBar}${filterPanel}<div id="community-results"></div></div>`;
  }
  function paintCommunity(){if(section==='mine'&&!profile())section='discover';main.innerHTML=communityChrome();paintResults();}
  function paintResults(){const container=document.querySelector('#community-results');if(!container)return;
    if(section==='discussions'){
      const list=discussions.filter(p=>(!topic||p.topic===topic)&&`${p.title} ${p.body}`.toLowerCase().includes(search.toLowerCase()));
      container.innerHTML=`<div class="community-results-head"><strong>${list.length} ${list.length===1?'post':'posts'}</strong><div><button class="button small" data-social="share-activity">Share activity</button><button class="button small primary" data-social="compose">${icon('plus',15)} New post</button></div></div>${discussions.length?`<div class="topic-tabs" role="group" aria-label="Discussion topic"><button class="topic-tab ${!topic?'active':''}" data-social-topic="">All</button>${topics.map(t=>`<button class="topic-tab ${t===topic?'active':''}" data-social-topic="${e(t)}">${t}</button>`).join('')}</div>`:''}${list.map(postCard).join('')||'<div class="community-simple-empty">No posts yet.</div>'}`;
    }else{
      const list=clubs.filter(c=>(section!=='mine'||c.joined)&&(!suburb||c.suburb===suburb)&&(!interest||c.interests.includes(interest))&&`${c.name} ${c.description} ${c.suburb} ${c.interests.join(' ')}`.toLowerCase().includes(search.toLowerCase()));
      container.innerHTML=`${section==='discover'&&!clubs.length&&!search&&!suburb&&!interest?demoSection():''}<div class="community-results-head"><strong>${list.length} ${list.length===1?'club':'clubs'}</strong></div>${list.length?`<div class="club-grid">${list.map(clubCard).join('')}</div>`:section==='mine'&&!profile()?empty('Join to see your clubs','Your clubs will appear here.','Join Family Finds','register'):section==='mine'?empty('No clubs yet','Explore clubs to join one.','Explore clubs','explore'):clubs.length||search||suburb||interest?empty('No clubs found','Try another search or filter.','Clear filters','clear-filters'):empty('Start a club','Bring local families together.','Start a club','create-club')}`;
    }
  }
  function empty(title,body,label,action){return `<div class="empty-state"><div class="empty-icon">${icon('people',35)}</div><h3>${title}</h3><p>${body}</p><button class="button primary" data-social="${action}">${label}</button></div>`;}
  function clubCard(c){
    const glyph=c.interests.includes('Arts & crafts')?'art':c.interests.includes('Books & stories')?'book':c.interests.includes('Outdoor play')||c.interests.includes('Nature & gardening')?'leaf':'people';
    const state=c.joined?'Joined':c.requested?'Request pending':c.is_private?'Approval needed':'Open to join';
    return `<article class="club-card compact-club-card"><a class="compact-club-link" href="#club/${e(c.id)}" aria-label="View ${e(c.name)}"><span class="compact-club-icon ${e(c.color)}">${icon(glyph,23)}</span><span class="compact-club-content"><strong>${e(c.name)}</strong><span class="compact-club-location">${e(c.suburb)}${c.interests[0]?` · ${e(c.interests[0])}`:''}</span><span class="compact-club-description">${e(c.description)}</span></span><span class="compact-club-arrow" aria-hidden="true">${icon('arrow',17)}</span></a><div class="compact-club-meta"><span class="compact-club-state">${state}</span><span>${c.member_count} ${c.member_count===1?'member':'members'}</span></div></article>`;
  }
  function postCard(p){return `<article class="post-card"><div class="post-top"><a href="#member/${p.author_id}" class="avatar" aria-label="View ${e(p.author)}’s profile">${e(initials(p.author))}</a><div><a class="author" href="#member/${p.author_id}">${e(p.author)}</a><div class="post-time">${p.suburb?`${e(p.suburb)} · `:''}${ago(p.created_at)}</div></div><span class="topic-badge">${e(p.topic)}</span></div><h3><a href="#post/${p.id}">${e(p.title)}</a></h3><p class="post-body">${e(p.body)}</p>${p.link?`<a class="linked-event" href="${e(p.link)}" target="_blank" rel="noopener noreferrer">${icon('external',18)}<span>Open shared link</span>${icon('arrow',16)}</a>`:''}<div class="post-actions"><button data-reaction="${p.id}" data-liked="${p.liked?'true':'false'}" aria-pressed="${!!p.liked}">${icon('heart',17)} ${p.helpful_count||0}</button><button data-open-post="${p.id}">${icon('message',17)} ${p.reply_count||0} replies</button><button data-share-post="${p.id}">${icon('share',17)} Share</button></div></article>`;}
  function rulesList(){return `<ul class="community-rules"><li>Be kind and inclusive.</li><li>Keep children's details private.</li><li>Arrange meetups in public places.</li></ul>`;}
  function rulesAgreement(){return `<div class="rules-agreement"><strong>Community rules</strong>${rulesList()}<label><input type="checkbox" name="rulesAccepted" required> I agree to follow these rules</label></div>`;}
  function clubPage(){
    const joinAction=club.joined?`<button class="button primary" data-social="compose">${icon('plus',16)} Start a discussion</button>${club.isOwner?'<button class="button" data-social="edit-club">Edit club</button>':'<button class="button" data-social="leave-club">Leave club</button>'}`:club.requested?'<button class="button" data-social="cancel-request">Request pending · cancel</button>':`<button class="button primary" data-social="join-club">${club.is_private?'Request to join':'Join club'}</button>`;
    const requestPanel=club.isOwner?`<section class="form-panel owner-panel"><h2>Join requests ${joinRequests.length?`(${joinRequests.length})`:''}</h2>${joinRequests.length?joinRequests.map(p=>`<div class="moderation-row"><span>${e(p.name)}${p.suburb?` · ${e(p.suburb)}`:''}</span><div><button class="button small primary" data-approve-request="${e(p.id)}">Approve</button><button class="button small" data-decline-request="${e(p.id)}">Decline</button><button class="button small danger" data-club-block="${e(p.id)}" data-member-name="${e(p.name)}">Block</button></div></div>`).join(''):'<p class="subtle">No requests yet.</p>'}<h2>Blocked members</h2>${blockedMembers.length?blockedMembers.map(p=>`<div class="moderation-row"><span>${e(p.name)}</span><button class="button small" data-unblock-member="${e(p.id)}">Unblock</button></div>`).join(''):'<p class="subtle">No blocked members.</p>'}</section>`:'';
    const content=clubTab==='manage'&&club.isOwner?requestPanel:!club.joined?`<div class="form-panel club-join-explainer"><h2>${club.requested?'Request sent':club.is_private?'Owner approval needed':'Join to take part'}</h2><p>${club.requested?'You can join once the owner approves.':club.is_private?'Request access to meet members and read discussions.':'Join to meet members and read discussions.'}</p></div>`:clubTab==='members'?`<div class="member-list">${members.map(memberCard).join('')}</div>`:`<div class="post-composer"><div class="avatar">${e(initials(profile()?.name))}</div><button data-social="compose">Start a discussion…</button>${icon('message',19)}</div>${discussions.map(postCard).join('')||empty('Say hello.','Start a discussion or suggest a meetup.','Start a discussion','compose')}`;
    return `<a class="back-link" href="#community">${icon('back',16)} All clubs</a><section class="club-detail-head"><div class="club-detail-kicker">${e(club.suburb)} <span>·</span> ${club.is_private?'Approval required':'Open to join'}${club.is_starter?' · Family starter club':''}</div><h1>${e(club.name)}</h1><p class="club-detail-description">${e(club.description)}</p><div class="club-detail-meta"><span>${icon('people',16)} ${club.member_count} ${club.member_count===1?'member':'members'}</span><span>By ${e(club.owner_name)}</span></div><div class="club-tags">${[...club.interests,...club.ages].slice(0,4).map(i=>`<span class="tag">${e(i)}</span>`).join('')}</div><div class="club-head-actions">${joinAction}<button class="button" data-share-club="${e(club.id)}">${icon('share',16)} Invite link</button>${club.facebook_url?`<a class="button" href="${e(club.facebook_url)}" target="_blank" rel="noopener noreferrer">Facebook ${icon('external',15)}</a>`:''}</div></section><div class="section-tabs"><button class="${clubTab==='discussions'?'active':''}" data-club-tab="discussions">Discussions</button><button class="${clubTab==='members'?'active':''}" data-club-tab="members">Members</button>${club.isOwner?`<button class="${clubTab==='manage'?'active':''}" data-club-tab="manage">Requests ${joinRequests.length?`(${joinRequests.length})`:''}</button>`:''}</div><div class="club-detail-body">${content}</div>`;
  }
  function memberCard(p){return `<div class="member-card"><a href="#member/${e(p.id)}" class="member-card-person"><span class="avatar">${e(initials(p.name))}</span><span><strong>${e(p.name)}</strong><small>${p.isOwner?'Club owner':e(p.suburb)||'Club member'}</small></span></a>${club.isOwner&&!p.isOwner?`<button class="button small danger" data-club-block="${e(p.id)}" data-member-name="${e(p.name)}">Block</button>`:''}</div>`;}
  function chips(name,values,selected=[]){return `<div class="chip-select">${values.map(v=>`<label><input type="checkbox" name="${name}" value="${e(v)}" ${selected.includes(v)?'checked':''}>${e(v)}</label>`).join('')}</div>`;}
  function authPage(page){queueMicrotask(mountGoogleButton);const register=page==='register';return `<div class="auth-layout"><section class="auth-story"><div class="eyebrow">A LITTLE MORE CONNECTED</div><h1>Good finds.<br>Great company.</h1><p>A place for your family to discover more, spend less and feel part of the neighbourhood.</p><ul class="auth-benefits"><li>${icon('calendar',21)} Find affordable things to do together</li><li>${icon('people',21)} Join clubs close to home</li><li>${icon('heart',21)} Give a little help. Get a little support.</li></ul></section><section class="auth-card"><img src="assets/logo.png" alt="Family Finds" width="48" height="48"><h2>${register?'Make yourself at home.':'Welcome back.'}</h2>${connectionError?`<p class="inline-error">${e(connectionError)}</p><button class="button" data-social="retry">Retry connection</button>`:!ready?'<p>Connecting to your account…</p>':profile()?`<p>You’re signed in as ${e(profile().name)}.</p><a href="#community" class="button primary">Explore your community ${icon('arrow',17)}</a>`:register?`<p>Join a community that makes family life a little easier.</p><form id="register-form"><label for="register-name">Your display name</label><input id="register-name" name="name" autocomplete="name" required maxlength="60" placeholder="How should neighbours know you?"><label for="register-email">Email</label><input type="email" id="register-email" name="email" autocomplete="email" required maxlength="254" placeholder="you@example.com"><label for="register-password">Password</label><input type="password" id="register-password" name="password" autocomplete="new-password" required minlength="10" maxlength="128" placeholder="At least 10 characters"><label for="register-suburb">Your suburb</label><input id="register-suburb" name="suburb" autocomplete="address-level2" required maxlength="60" placeholder="e.g. New Farm"><label>Your interests</label>${chips('interests',interests)}<div class="form-error" role="alert"></div><button class="button primary" type="submit">Create my account ${icon('arrow',17)}</button></form>`:`<p>Log in to find your clubs, conversations and saved activities.</p><form id="login-form"><label for="login-email">Email</label><input type="email" id="login-email" name="email" autocomplete="email" required maxlength="254" placeholder="you@example.com"><label for="login-password">Password</label><input type="password" id="login-password" name="password" autocomplete="current-password" required minlength="10" maxlength="128" placeholder="Your password"><div class="form-error" role="alert"></div><button class="button primary" type="submit">Log in ${icon('arrow',17)}</button></form>`}${ready&&!connectionError&&!profile()?'<div class="auth-divider"><span>or</span></div><div id="google-signin" class="google-signin"></div><p id="google-signin-status" class="auth-google-status" role="status" aria-live="polite">Loading Google sign-in…</p>':''}<p class="auth-small">${register?'Already part of the community? <a class="text-link" href="#login">Log in</a>':'New to Family Finds? <a class="text-link" href="#register">Join us</a>'}</p></section></div>`;}
  function profilePage(data,own){const p=data.profile;const joined=clubs.filter(c=>data.clubs.some(m=>m.id===c.id));return `<a class="back-link" href="#community">${icon('back',16)} Community</a><div class="profile-layout"><aside class="profile-card"><div class="avatar large">${e(initials(p.name))}</div><h1>${e(p.name)}</h1>${p.suburb?`<p>${icon('pin',15)} ${e(p.suburb)}</p>`:''}<p>${e(p.bio)||'Part of the Family Finds community.'}</p><div class="club-tags">${p.interests.map(i=>`<span class="tag">${e(i)}</span>`).join('')}</div>${own?'<a class="button" href="#edit-profile">Edit profile</a>':''}</aside><section><div class="section-heading no-margin"><h2>${own?'Your':'Community'} clubs</h2>${own?'<button class="text-link plain-button" data-social="create-club">Create a club</button>':''}</div><div style="height:22px"></div>${joined.length?`<div class="club-grid">${joined.map(clubCard).join('')}</div>`:empty(own?'Find a club that feels like you.':'No clubs to show yet.',own?'Explore clubs by suburb and interest, or start one of your own.':'This member has not joined a club yet.','Explore clubs','explore')}</section></div>`;}
  function settingsPage(){
    const p=profile();
    return `<div class="page-heading"><div><div class="eyebrow">YOUR ACCOUNT</div><h1>Account settings</h1><p class="intro">Update your profile and sign-in details.</p></div></div><div class="settings-layout"><nav class="setting-nav" aria-label="Account"><a href="#settings" class="active" aria-current="page">Account</a><a href="#edit-profile">Profile & privacy</a><a href="#profile">View profile</a></nav><div class="settings-stack"><section class="form-panel account-settings-panel"><h2>Profile</h2><div class="setting-row"><div><strong>${e(p.name)}</strong><p>${e(p.suburb)}</p></div><a class="button" href="#edit-profile">Edit profile</a></div></section>${p.passwordAccount?`<section class="form-panel account-settings-panel"><h2>Change email</h2><p class="subtle">Current email: ${e(p.email)}</p><form id="account-email-form"><label for="new-email">New email</label><input id="new-email" type="email" name="email" required maxlength="254" autocomplete="email"><label for="email-current-password">Current password</label><input id="email-current-password" type="password" name="currentPassword" required autocomplete="current-password"><div class="form-error" role="alert"></div><div class="form-actions"><button class="button primary" type="submit">Save email</button></div></form></section><section class="form-panel account-settings-panel"><h2>Change password</h2><form id="account-password-form"><label for="password-current">Current password</label><input id="password-current" type="password" name="currentPassword" required autocomplete="current-password"><label for="password-new">New password</label><input id="password-new" type="password" name="newPassword" required minlength="10" maxlength="128" autocomplete="new-password"><label for="password-confirm">Confirm new password</label><input id="password-confirm" type="password" name="confirmPassword" required minlength="10" maxlength="128" autocomplete="new-password"><div class="form-error" role="alert"></div><div class="form-actions"><button class="button primary" type="submit">Save password</button></div></form></section>`:`<section class="form-panel account-settings-panel"><h2>Sign-in details</h2><p class="subtle">This account uses Google sign-in. Change your email or password in your Google Account.</p></section>`}</div></div>`;
  }
  function editProfilePage(){const p=profile();return `<div class="page-heading"><div><div class="eyebrow">PROFILE & PRIVACY</div><h1>Edit your profile.</h1><p class="intro">Choose what neighbours can see.</p></div></div><div class="settings-layout"><nav class="setting-nav" aria-label="Account"><a href="#settings">Overview</a><a href="#edit-profile" class="active" aria-current="page">Profile & privacy</a><a href="#profile">View profile</a></nav><section class="form-panel"><h2>Profile details</h2><p class="subtle">Your email stays private. Share only what you’re comfortable with.</p><form id="settings-form"><div class="form-grid"><div class="form-field"><label for="settings-name">Display name</label><input id="settings-name" name="name" required maxlength="60" autocomplete="name" value="${e(p.name)}"></div><div class="form-field"><label for="settings-suburb">Suburb</label><input id="settings-suburb" name="suburb" required maxlength="60" autocomplete="address-level2" value="${e(p.suburb)}"></div><div class="form-field full"><label for="settings-bio">A little about you</label><textarea id="settings-bio" name="bio" maxlength="500" placeholder="A few things your family enjoys…">${e(p.bio)}</textarea></div><div class="form-field full"><label>Interests</label>${chips('interests',interests,p.interests)}</div><div class="form-field full"><label>Family age groups · optional</label>${chips('ages',ageGroups,p.ages)}<p class="help-text">General age groups only. These are private to your account.</p></div></div><div class="setting-row"><div><strong>Show my suburb</strong><p>Let other members see your suburb on your profile and posts.</p></div><input type="checkbox" name="showSuburb" aria-label="Show my suburb" ${p.showSuburb?'checked':''}></div><div class="setting-row"><div><strong>Show my interests</strong><p>Help neighbours spot the things you have in common.</p></div><input type="checkbox" name="showInterests" aria-label="Show my interests" ${p.showInterests?'checked':''}></div><div class="setting-row"><div><strong>Account email</strong><p>${e(p.email)}</p></div><span class="tag">Family Finds account</span></div><div class="form-error" role="alert"></div><div class="form-actions"><button class="button primary" type="submit">Save changes</button></div></form></section></div>`;}
  function clubForm(value={}){
    const approval=value.id?!!value.is_private:true;
    return `<div class="eyebrow">LOCAL FAMILY CLUB</div><h2 id="modal-title">${value.id?'Edit club':'Create a club'}</h2><form id="club-form" data-id="${e(value.id||'')}"><div class="club-form-grid"><div><label for="club-name">Club name</label><input id="club-name" name="name" required maxlength="80" value="${e(value.name||'')}" placeholder="e.g. New Farm families"></div><div><label for="club-home">Suburb</label><input id="club-home" name="suburb" required maxlength="60" value="${e(value.suburb||profile()?.suburb||'')}" placeholder="Club suburb"></div></div><label for="club-description">What is your club about?</label><textarea id="club-description" name="description" required maxlength="1000" placeholder="One or two sentences is enough.">${e(value.description||'')}</textarea><label class="club-privacy-option"><input type="checkbox" name="private" ${approval?'checked':''}><span>Approve each member<small>Your club appears in Discover. Discussions stay members-only.</small></span></label><details class="club-form-options"><summary>More options</summary><label>Interests</label>${chips('interests',interests,value.interests||[])}<label>Age groups</label>${chips('ages',ageGroups,value.ages||[])}<label for="club-facebook">Facebook or Messenger link · optional</label><input type="url" id="club-facebook" name="facebookUrl" maxlength="1500" placeholder="https://…" value="${e(value.facebook_url||'')}"><label for="club-color">Club colour</label><select id="club-color" name="color">${[['blue','Sky blue'],['green','Garden green'],['purple','Soft violet'],['orange','Warm apricot']].map(([id,name])=>`<option value="${id}" ${value.color===id?'selected':''}>${name}</option>`).join('')}</select></details>${value.id?'':rulesAgreement()}<div class="form-error" role="alert"></div><div class="form-actions"><button class="button" type="button" data-close>Cancel</button><button class="button primary" type="submit">${value.id?'Save changes':'Create club'}</button></div></form>`;
  }
  async function compose(prefill={}){if(!requireProfile())return;try{const c=await api('/clubs');clubs=c.clubs;const selected=route==='club'?club?.id:'';showDialog(`<div class="eyebrow">SOMETHING TO SHARE</div><h2 id="modal-title">Start a conversation.</h2><form id="discussion-form"><label for="discussion-club">Where would you like to post?</label><select id="discussion-club" name="clubId"><option value="">Brisbane community</option>${clubs.filter(c=>c.joined).map(c=>`<option value="${c.id}" ${selected===c.id?'selected':''}>${e(c.name)}</option>`).join('')}</select><label for="discussion-topic">Topic</label><select id="discussion-topic" name="topic">${topics.map(t=>`<option>${t}</option>`).join('')}</select><label for="discussion-title">Title</label><input id="discussion-title" name="title" required maxlength="120" placeholder="Give your neighbours a little context" value="${e(prefill.title||'')}"><label for="discussion-body">Your message</label><textarea id="discussion-body" name="body" required maxlength="4000" placeholder="Share a find, make a plan, ask a question…">${e(prefill.body||'')}</textarea><label for="discussion-link">Share a link · optional</label><input type="url" id="discussion-link" name="link" placeholder="https://…" value="${e(prefill.link||'')}" maxlength="1500"><div class="form-error" role="alert"></div><div class="form-actions"><button class="button" type="button" data-close>Cancel</button><button class="button primary" type="submit">Post discussion</button></div></form>`);}catch(error){notify(error.message);}}
  async function shareActivity(){
    if(!requireProfile())return;
    try{
      const data=await api('/clubs');clubs=data.clubs;
      showDialog(`<div class="eyebrow">COMMUNITY ACTIVITY</div><h2 id="modal-title">Share an activity</h2><p class="subtle">Suggest something for local families. This creates a community post, not an official Council event listing.</p><form id="activity-form"><label for="activity-club">Share with</label><select id="activity-club" name="clubId"><option value="">Brisbane community</option>${clubs.filter(c=>c.joined).map(c=>`<option value="${e(c.id)}">${e(c.name)}</option>`).join('')}</select><label for="activity-title">Activity name</label><input id="activity-title" name="title" required maxlength="120" placeholder="e.g. Saturday park picnic"><label for="activity-date">Date</label><input id="activity-date" type="date" name="date" required><label for="activity-place">Place</label><input id="activity-place" name="place" required maxlength="160" placeholder="Park, library or suburb"><label for="activity-description">What should families know?</label><textarea id="activity-description" name="description" required maxlength="3000" placeholder="Include time, ages, cost and any booking instructions."></textarea><label for="activity-link">More information or booking link · optional</label><input id="activity-link" type="url" name="link" maxlength="1500" placeholder="https://…"><div class="form-error" role="alert"></div><div class="form-actions"><button class="button" type="button" data-close>Cancel</button><button class="button primary" type="submit">Post activity</button></div></form>`);
    }catch(error){notify(error.message);}
  }
  function postPage(data){const p=data.post;const mine=p.author_id===profile()?.id;return `<a class="back-link" href="${p.club_id?'#club/'+p.club_id:'#community'}">${icon('back',16)} ${p.club_id?'Back to club':'Community'}</a><div class="thread-wrap"><article class="post-card"><div class="post-top"><a href="#member/${p.author_id}" class="avatar">${e(initials(p.author))}</a><div><a class="author" href="#member/${p.author_id}">${e(p.author)}</a><div class="post-time">${ago(p.created_at)}</div></div><span class="topic-badge">${e(p.topic)}</span></div><h1 class="thread-title">${e(p.title)}</h1><p class="post-body">${e(p.body)}</p>${p.link?`<a class="text-link" href="${e(p.link)}" target="_blank" rel="noopener noreferrer">Open shared link ${icon('external',16)}</a>`:''}<div class="post-actions"><button data-share-post="${p.id}">${icon('share',17)} Share discussion</button>${mine?`<button data-delete-post="${p.id}">Remove discussion</button>`:''}</div></article><section class="form-panel"><h2>${data.replies.length} ${data.replies.length===1?'reply':'replies'}</h2>${data.replies.map(r=>`<article class="reply"><a href="#member/${r.author_id}"><strong>${e(r.author)}</strong></a><span class="post-time"> · ${ago(r.created_at)}</span><p>${e(r.body)}</p></article>`).join('')||'<p class="subtle">A friendly hello can go a long way. Be the first to reply.</p>'}${profile()?`<form id="club-reply-form" data-id="${p.id}"><label for="thread-reply">Join the conversation</label><textarea id="thread-reply" name="body" required maxlength="2000" placeholder="Write a thoughtful reply…"></textarea><div class="form-error" role="alert"></div><div class="form-actions"><button class="button primary" type="submit">Post reply</button></div></form>`:'<a class="button primary" href="#login">Log in to reply</a>'}</section></div>`;}
  function publicLink(hash){const url=new URL(window.FAMILY_FINDS_CONFIG?.publicSiteUrl||location.href);url.hash=hash.replace(/^#/,'');return url.href;}
  function showInvite(id){
    const url=publicLink(`club/${encodeURIComponent(id)}`);
    showDialog(`<div class="eyebrow">SHARE YOUR CLUB</div><h2 id="modal-title">Invite families</h2><p class="subtle">People can also find ${e(club.name)} in Discover.${club.is_private?' The owner approves each request.':' They can join straight away.'}</p><label for="invite-link">Club link</label><div class="invite-link-row"><input id="invite-link" readonly value="${e(url)}"><button class="button primary" type="button" data-copy-invite>Copy link</button></div>`);
  }
  async function share(hash){const url=publicLink(hash);try{await navigator.clipboard.writeText(url);notify('Link copied.');}catch{showDialog(`<h2 id="modal-title">Share this link</h2><input id="share-link" readonly aria-label="Share link" value="${e(url)}">`);document.querySelector('#share-link').select();}}
  async function action(name){
    if(name==='register')return navigate('register');if(name==='explore'){section='discover';return navigate('community');}
    if(name==='clear-filters'){search='';suburb='';interest='';filtersOpen=false;paintCommunity();return;}
    if(name==='retry'){ready=false;connectionError='';render();return init();}
    if(name==='logout'){window.google?.accounts?.id?.disableAutoSelect();try{await api('/auth/logout',{method:'POST'});}finally{localStorage.removeItem(sessionKey);me={signedIn:false,email:'',profile:null};saved=[];interestByEvent={};updateCount();accountHeader();navigate('home');notify('You’re logged out.');}return;}
    if(name==='create-club'){if(!requireProfile())return;if(!await clubServerReady())throw new Error('Club approvals are not available on the live server yet. Please try again after the community update.');showDialog(clubForm());return;}
    if(name==='share-activity')return shareActivity();
    if(name==='edit-club'){if(requireProfile()&&club?.isOwner){if(!await clubServerReady())throw new Error('Club editing is unavailable until the community update is deployed.');showDialog(clubForm(club));}return;}
    if(name==='compose')return compose();
    if(name==='join-club'){if(!requireProfile())return;showDialog(`<div class="eyebrow">${club.is_private?'PRIVATE CLUB':'COMMUNITY CLUB'}</div><h2 id="modal-title">${club.is_private?'Request to join':'Join'} ${e(club.name)}</h2><p class="subtle">${club.is_private?'The owner will approve your request before you can see members and discussions.':'You can leave this club whenever you like.'}</p><form id="join-club-form">${rulesAgreement()}<div class="form-error" role="alert"></div><div class="form-actions"><button class="button" type="button" data-close>Cancel</button><button class="button primary" type="submit">${club.is_private?'Send request':'Join club'}</button></div></form>`);return;}
    if(name==='cancel-request'){await api(`/clubs/${club.id}/membership`,{method:'DELETE'});notify('Join request cancelled.');return render();}
    if(name==='leave-club'){showDialog(`<h2 id="modal-title">Leave ${e(club.name)}?</h2><p>You can join again later. Your existing discussions and replies will remain in the club.</p><div class="form-actions"><button class="button" data-close>Stay in club</button><button class="button danger" data-social="confirm-leave">Leave club</button></div>`);return;}
    if(name==='confirm-leave'){await api(`/clubs/${club.id}/membership`,{method:'DELETE'});modal.close();notify('You left the club.');render();}
  }
  document.addEventListener('click',async event=>{const target=event.target.closest('button,[data-open-post]');if(!target)return;try{
    if(target.hasAttribute('data-demo-club')){const draft=demoClubs.find(c=>c.id===target.dataset.demoClub);if(draft)showDialog(`<div class="eyebrow">DRAFT CLUB · TRADESHOW PREVIEW</div><h2 id="modal-title">${e(draft.name)}</h2><p>${e(draft.description)}</p><p><strong>Neighbourhood:</strong> ${e(draft.suburb)}</p><p><strong>First step:</strong> ${e(draft.plan)}</p><p class="subtle">This preview has no members or posts yet. Create a real club to invite families.</p><div class="form-actions"><button class="button" data-close>Close</button><button class="button primary" data-social="create-club">Create a real club</button></div>`);return;}
    if(target.dataset.social)await action(target.dataset.social);
    if(target.hasAttribute('data-community-rules')){showDialog(`<h2 id="modal-title">Community rules</h2>${rulesList()}<div class="form-actions"><button class="button primary" type="button" data-close>Got it</button></div>`);return;}
    if(target.hasAttribute('data-community-filters')){filtersOpen=!filtersOpen;document.querySelector('#community-filter-panel').hidden=!filtersOpen;target.setAttribute('aria-expanded',String(filtersOpen));return;}
    if(target.hasAttribute('data-clear-community-filters')){await action('clear-filters');return;}
    if(target.hasAttribute('data-community-section')){section=target.dataset.communitySection;search='';suburb='';interest='';filtersOpen=false;paintCommunity();}
    if(target.hasAttribute('data-interest')){interest=interest===target.dataset.interest?'':target.dataset.interest;section='discover';paintCommunity();}
    if(target.hasAttribute('data-social-topic')){topic=target.dataset.socialTopic;paintResults();}
    if(target.hasAttribute('data-club-idea')){if(requireProfile()){if(!await clubServerReady())throw new Error('Club approvals are unavailable until the community update is deployed.');showDialog(clubForm({name:target.dataset.clubIdea,interests:[target.dataset.ideaInterest]}));}}
    if(target.hasAttribute('data-club-tab')){clubTab=target.dataset.clubTab;main.innerHTML=clubPage();}
    if(target.hasAttribute('data-open-post'))navigate('post/'+target.dataset.openPost);
    if(target.hasAttribute('data-share-post'))await share('#post/'+target.dataset.sharePost);
    if(target.hasAttribute('data-share-club'))showInvite(target.dataset.shareClub);
    if(target.hasAttribute('data-copy-invite')){const input=document.querySelector('#invite-link');try{await navigator.clipboard.writeText(input.value);notify('Invite link copied.');modal.close();}catch{input.select();notify('Select and copy the invite link.');}}
    if(target.hasAttribute('data-reaction')){if(!requireProfile())return;target.disabled=true;await api(`/posts/${target.dataset.reaction}/helpful`,{method:target.dataset.liked==='true'?'DELETE':'POST'});render();}
    if(target.hasAttribute('data-delete-post'))showDialog(`<h2 id="modal-title">Remove this discussion?</h2><p>This also removes its replies. This cannot be undone.</p><div class="form-actions"><button class="button" data-close>Cancel</button><button class="button danger" data-confirm-delete="${target.dataset.deletePost}">Remove discussion</button></div>`);
    if(target.hasAttribute('data-confirm-delete')){await api(`/posts/${target.dataset.confirmDelete}`,{method:'DELETE'});modal.close();notify('Discussion removed.');navigate('community');}
    if(target.hasAttribute('data-approve-request')){await api(`/clubs/${club.id}/requests/${encodeURIComponent(target.dataset.approveRequest)}`,{method:'POST'});notify('Request approved.');render();}
    if(target.hasAttribute('data-decline-request')){await api(`/clubs/${club.id}/requests/${encodeURIComponent(target.dataset.declineRequest)}`,{method:'DELETE'});notify('Request declined.');render();}
    if(target.hasAttribute('data-club-block')){showDialog(`<h2 id="modal-title">Block ${e(target.dataset.memberName)}?</h2><p>They will leave this club and cannot rejoin or see its discussions until you unblock them.</p><div class="form-actions"><button class="button" data-close>Cancel</button><button class="button danger" data-confirm-block="${e(target.dataset.clubBlock)}">Block member</button></div>`);}
    if(target.hasAttribute('data-confirm-block')){await api(`/clubs/${club.id}/blocks/${encodeURIComponent(target.dataset.confirmBlock)}`,{method:'POST'});modal.close();notify('Member blocked from this club.');clubTab='manage';render();}
    if(target.hasAttribute('data-unblock-member')){await api(`/clubs/${club.id}/blocks/${encodeURIComponent(target.dataset.unblockMember)}`,{method:'DELETE'});notify('Member unblocked. They can request to join again.');render();}
  }catch(error){notify(error.message);target.disabled=false;}});
  document.addEventListener('input',event=>{if(event.target.id==='club-search'){search=event.target.value;paintResults();}});
  document.addEventListener('focusin',event=>{
    if(event.target.matches('input[name="suburb"]')) attachSuburbList(event.target);
  });
  document.addEventListener('change',event=>{
    if(event.target.id==='club-suburb'){suburb=event.target.value;paintCommunity();}
    if(event.target.matches('input[name="suburb"]')) event.target.value=formatSuburb(event.target.value);
  });
  document.addEventListener('submit',async event=>{
    const form=event.target;if(!['register-form','login-form','settings-form','account-email-form','account-password-form','club-form','join-club-form','discussion-form','activity-form','club-reply-form'].includes(form.id))return;event.preventDefault();
    const suburbInput=form.querySelector('input[name="suburb"]');
    if(suburbInput) suburbInput.value=formatSuburb(suburbInput.value);
    const d=new FormData(form),b=Object.fromEntries(d);const button=form.querySelector('button[type=submit]');const feedback=form.querySelector('.form-error');
    if([...form.querySelectorAll('[required]')].some(field=>field.type==='checkbox'?!field.checked:!field.value.trim())){feedback.innerHTML='<p class="inline-error">Please complete the required fields and agree to the community rules.</p>';return;}
    button.disabled=true;feedback.textContent='';
    try{
      if(form.id==='register-form'){const result=await api('/auth/register',{method:'POST',body:JSON.stringify({...b,interests:d.getAll('interests'),ages:[]})});localStorage.setItem(sessionKey,result.token);me={signedIn:true,email:result.profile.email,profile:result.profile};saved=[];await refreshEventInterest();accountHeader();notify('Welcome to Family Finds.');navigate('community');}
      if(form.id==='login-form'){const result=await api('/auth/login',{method:'POST',body:JSON.stringify(b)});localStorage.setItem(sessionKey,result.token);me={signedIn:true,email:result.profile.email,profile:result.profile};const savedData=await api('/saved');saved=savedData.events;await refreshEventInterest();updateCount();accountHeader();notify('Welcome back.');navigate('community');}
      if(form.id==='settings-form'){const result=await api('/profile',{method:'PATCH',body:JSON.stringify({...b,interests:d.getAll('interests'),ages:d.getAll('ages'),showSuburb:d.has('showSuburb'),showInterests:d.has('showInterests')})});me.profile=result.profile;accountHeader();notify('Your profile and privacy settings are saved.');}
      if(form.id==='account-email-form'||form.id==='account-password-form'){if(form.id==='account-password-form'&&b.newPassword!==b.confirmPassword)throw new Error('New passwords do not match.');const result=await api(form.id==='account-email-form'?'/account/email':'/account/password',{method:'PATCH',body:JSON.stringify(b)});localStorage.setItem(sessionKey,result.token);me.profile=result.profile;me.email=result.profile.email;accountHeader();main.innerHTML=settingsPage();notify(form.id==='account-email-form'?'Email updated.':'Password updated.');}
      if(form.id==='club-form'){if(!await clubServerReady())throw new Error('Club approvals are unavailable until the community update is deployed.');const id=form.dataset.id;const result=await api(id?`/clubs/${id}`:'/clubs',{method:id?'PATCH':'POST',body:JSON.stringify({...b,interests:d.getAll('interests'),ages:d.getAll('ages'),private:d.has('private'),rulesAccepted:d.has('rulesAccepted')})});modal.close();clubTab='discussions';notify(id?'Club updated.':'Club created. Use Invite link to share it.');navigate('club/'+result.club.id);}
      if(form.id==='join-club-form'){const result=await api(`/clubs/${club.id}/membership`,{method:'POST',body:JSON.stringify({rulesAccepted:d.has('rulesAccepted')})});modal.close();notify(result.requested?'Request sent to the club owner.':'Welcome to the club.');render();}
      if(form.id==='discussion-form'){const result=await api('/posts',{method:'POST',body:JSON.stringify(b)});modal.close();notify('Discussion posted.');navigate('post/'+result.id);}
      if(form.id==='activity-form'){const [year,month,day]=b.date.split('-');const body=`When: ${day}/${month}/${year}\nWhere: ${b.place.trim()}\n\n${b.description.trim()}`;const result=await api('/posts',{method:'POST',body:JSON.stringify({clubId:b.clubId,title:b.title,body,topic:'Meetups',link:b.link})});modal.close();notify('Activity shared with the community.');navigate('post/'+result.id);}
      if(form.id==='club-reply-form'){await api(`/posts/${form.dataset.id}/replies`,{method:'POST',body:JSON.stringify(b)});notify('Your reply is posted.');render();}
    }catch(error){feedback.innerHTML=`<p class="inline-error">${e(error.message)}</p>`;}finally{button.disabled=false;}
  });
  return {init,handles,show,profile,requireProfile,api,compose,eventInterestDetail,toggleEventInterest,refreshEventInterest};
})();
