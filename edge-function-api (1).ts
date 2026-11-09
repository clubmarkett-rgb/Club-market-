// @ts-nocheck
// Club Market backend = Supabase Edge Function "api" (save as supabase/functions/api/index.ts).
// Each request loads a few SMALL tables, runs the rules in memory, then commits ONLY the changed rows in one
// atomic SQL call (fn_commit). Row versions stop two players buying the same last shares at the same time.
const DAY=864e5,HR=36e5,enc=new TextEncoder(),r2=n=>+(+n).toFixed(2),sg=n=>(n>0?'+':'')+r2(n),pc=n=>(n>0?'+':'')+n.toFixed(2)+'%',
 esc=s=>String(s==null?'':s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c])),
 hex=b=>[...new Uint8Array(b)].map(x=>x.toString(16).padStart(2,'0')).join(''),
 b64=u=>btoa(String.fromCharCode(...u)).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,''),
 rid=()=>hex(crypto.getRandomValues(new Uint8Array(5))),r6=()=>String(100000+crypto.getRandomValues(new Uint32Array(1))[0]%900000);
async function hmac(k,m){const key=await crypto.subtle.importKey('raw',enc.encode(k),{name:'HMAC',hash:'SHA-256'},false,['sign']);return hex(await crypto.subtle.sign('HMAC',key,enc.encode(m)))}
async function pbk(pin,salt){const key=await crypto.subtle.importKey('raw',enc.encode(pin),'PBKDF2',false,['deriveBits']);return hex(await crypto.subtle.deriveBits({name:'PBKDF2',hash:'SHA-256',salt:enc.encode(salt),iterations:100000},key,256))}
const hashPin=async p=>{const s=rid();return s+'$'+await pbk(p,s)},verify=async(p,h)=>{const[s,x]=String(h||'').split('$');return!!x&&await pbk(String(p),s)===x};
const cb=(S,i)=>S.clubs.find(c=>c.id==i),avail=c=>c.tot-c.held,waOf=u=>r2(u.spent-u.wadj),
 NU=o=>({fails:0,lk:0,bal:0,added:0,spent:0,recv:0,fees:0,re:0,gains:0,wadj:0,nbuy:0,nsell:0,nwin:0,inv:0,vol:0,...o});
export const wa=waOf;
const NUMS={users:['fails','lk','bal','added','spent','recv','fees','re','gains','wadj','nbuy','nsell','nwin','inv','vol','t','v'],clubs:['act','tot','min','max','nb','held','price','p0','bp','bt','lt','t','v'],hold:['q','cost','v']};
function norm(S){for(const k in NUMS)S[k].forEach(r=>NUMS[k].forEach(f=>{if(r[f]!=null)r[f]=+r[f]}));for(const f in S.set)S.set[f]=+S.set[f]}
export function stat(S,u){let sh=0,val=0,cost=0;for(const h of S.hold)if(h.u==u.id&&h.q>0){sh+=h.q;val+=h.q*cb(S,h.c).price;cost+=h.cost}return{sh,val:r2(val),un:r2(val-cost),re:u.re,gains:u.gains,added:u.added,spent:u.spent,recv:u.recv,fees:u.fees}}
const led=(S,u,type,amt,why,ref,now)=>{const p=u.bal;u.bal=r2(p+amt);S.led.push({id:rid(),u:u.id,type,amt,p,b:u.bal,ref:ref||'',why,t:now})},
 note=(S,u,title,msg,now,bc)=>S.notes.push({id:rid(),u,title,msg,t:now,r:0,bc:bc||null}),aud=(S,a,txt,now)=>S.aud.push({id:rid(),adm:a.id,a:txt,t:now});
// Pricing engine: match result (+ goal difference) + net buying/selling pressure (scaled up a little when few shares remain),
// capped per update, kept inside min/max and inside a rolling 24h band. Never touches anyone's points.
function reprice(S,c,x,now){const s=S.set;if(!s.auto)return;if(now-(c.bt||0)>=DAY){c.bp=c.price;c.bt=now}
 const pv=c.price,sh=1-c.held/c.tot,dp=Math.max(-s.dcap,Math.min(s.dcap,(c.nb||0)/c.tot*100*s.dem*(1+sh*.5))),mp=x.mp||0;
 let np=pv*(1+Math.max(-s.cap,Math.min(s.cap,mp+dp))/100);np=r2(Math.max(s.min,Math.min(s.max,Math.max(c.bp*(1-s.day/100),Math.min(c.bp*(1+s.day/100),np)))));
 if(Math.abs(np/pv-1)<.003)return;const w=[];if(x.why)w.push(x.why+' ('+sg(mp)+'%)');if(Math.abs(dp)>=.05)w.push((c.nb>0?'Net buying of ':'Net selling of ')+Math.abs(c.nb)+' shares, '+Math.round(sh*100)+'% of shares held ('+sg(dp)+'%)');
 S.ph.push({id:rid(),c:c.id,t:now,p:np,prev:pv,pct:r2((np/pv-1)*100),why:w.join(' + ')||'Market adjustment',mid:x.mid||null,opp:x.opp||null,res:x.res||null,comp:x.comp||'',adm:x.adm||'system',mp:r2(mp),dp:r2(dp)});c.price=np;c.lt=now;c.nb=0}
function boards(S){const P=S.users.filter(x=>x.role=='player').map(u=>{const s=stat(S,u),n=u.nbuy+u.nsell,pl=s.re+s.un,ret=u.inv?pl/u.inv*100:0,mx=Math.max(0,...S.hold.filter(h=>h.u==u.id&&h.q>0).map(h=>h.q*cb(S,h.c).price)),w=u.nsell?u.nwin/u.nsell*100:0;
 return{u,s,pl,ret,ok:n>=5&&u.nsell>=3,sc:.4*Math.max(0,Math.min(100,50+ret*2.5))+.25*w+.2*Math.min(100,n*10)+.15*(s.val?Math.min(100,(1-mx/s.val)*125):50)}}),o=r=>({u:{user:r.u.uname}});
 return[P.filter(r=>r.s.sh>0).sort((a,b)=>b.s.sh-a.s.sh).slice(0,5).map(r=>({...o(r),t:r.s.sh+' shares'})),P.filter(r=>r.pl>0).sort((a,b)=>b.pl-a.pl).slice(0,5).map(r=>({...o(r),t:sg(r.pl)+' pts',x:'Realised '+sg(r.s.re)+' · Unrealised '+sg(r.s.un)})),P.filter(r=>r.ok).sort((a,b)=>b.sc-a.sc).slice(0,5).map(r=>({...o(r),t:r.sc.toFixed(1)+'/100',x:'Return '+pc(r.ret)}))]}
// ---- change tracking: only rows that changed are written ----
const KEYS={users:'profiles',clubs:'clubs',hold:'holdings'},TB2={tx:'transactions',led:'ledger',notes:'notifications',matches:'matches',ph:'price_history',bc:'broadcasts',wam:'wa_adjust',aud:'audit_logs'};
function snap(S){S._s={};for(const k in KEYS)S._s[k]=new Map(S[k].map(r=>[r.id,JSON.stringify(r)]));S._ss=JSON.stringify(S.set);S._del={matches:[],broadcasts:[]}}
function diff(S){const ins={},upd={},del={},add=(o,t,x)=>(o[t]=o[t]||[]).push(x);
 for(const k in KEYS){const t=KEYS[k],seen=new Set();for(const r of S[k]){seen.add(r.id);const b=S._s[k].get(r.id);if(b===undefined)add(ins,t,{...r,v:0});else if(b!==JSON.stringify(r)){const o=JSON.parse(b),set={};for(const f in r)if(f!='v'&&JSON.stringify(r[f])!==JSON.stringify(o[f]))set[f]=r[f];if(Object.keys(set).length)add(upd,t,{id:r.id,v:o.v,set})}}
  for(const id of S._s[k].keys())if(!seen.has(id))add(del,t,id)}
 if(JSON.stringify(S.set)!==S._ss){const o=JSON.parse(S._ss),set={};for(const f in S.set)if(f!='v'&&f!='id'&&S.set[f]!==o[f])set[f]=S.set[f];if(Object.keys(set).length)add(upd,'settings',{id:1,v:o.v,set})}
 for(const k in TB2)if(S[k].length)ins[TB2[k]]=(ins[TB2[k]]||[]).concat(S[k]);
 for(const t in S._del)if(S._del[t].length)del[t]=(del[t]||[]).concat(S._del[t]);
 return Object.keys(ins).length+Object.keys(upd).length+Object.keys(del).length?{ins,upd,del}:null}
// ---- what the browser receives (cached for everyone for 20s per data version) ----
let PC=null;
const ds=(a,n)=>{if(a.length<=n)return a;const o=[];for(let i=0;i<n;i++)o.push(a[Math.round(i*(a.length-1)/(n-1))]);return o},
 agg=(c,now)=>{const h=c.hb||{},o={};for(const d of[1,7,14]){const k0=Math.floor((now-d*DAY)/HR),s=[0,0,0,0,0];for(const k in h)if(+k>=k0)for(let i=0;i<5;i++)s[i]+=h[k][i];o[d]=s}return o};
async function pubData(X,ver){const now=X.now();if(PC&&PC.ver==ver&&now-PC.at<2e4)return PC;const[h,m]=await Promise.all([X.db.hist(now-14*DAY),X.db.matches()]),by={};for(const r of h)(by[r.c]=by[r.c]||[]).push({t:+r.t,p:+r.p,prev:r.prev==null?null:+r.prev,pct:r.pct==null?null:+r.pct,why:r.why,res:r.res,comp:r.comp});PC={ver,at:now,by,m};return PC}
export async function buildView(S,u,X){const ad=u.role=='admin',now=X.now(),ver=await X.db.version(),[P,R]=await Promise.all([pubData(X,ver),X.db.rows(u.id,ad)]),
 sp=x=>{const{pin,op,fails,lk,uname,...r}=x;return{...r,user:uname,s:stat(S,x),wa:waOf(x)}},
 clubs=S.clubs.map(c=>{const a=ds(P.by[c.id]||[],80).slice();if(!a.length||a[a.length-1].p!==c.price)a.push({t:c.lt||c.t,p:c.price,why:'Current price'});const{hb,bp,bt,lt,nb,act,...r}=c;return{...r,on:act,ph:a,ag:agg(c,now)}}),ids=new Set(S.users.map(x=>x.id));
 return{me:sp(u),ver,set:S.set,clubs,matches:P.m,users:ad?S.users.map(sp).sort((a,b)=>a.t-b.t):[sp(u)],hold:ad?S.hold:S.hold.filter(h=>h.u==u.id),tx:R.tx,led:R.led,notes:R.notes,wam:R.wam,bc:R.bc.map(b=>({...b,to:(b.to||[]).filter(i=>ids.has(i))})),aud:R.aud,tk:R.tk,lbs:boards(S)}}
export async function tokenOk(t,X){const[id,exp,sig]=String(t||'').split('.');return id&&X.now()<+exp&&sig===await hmac(X.env.SESSION_SECRET,id+'.'+exp)?id:null}
export async function authUser(S,t,X){const id=await tokenOk(t,X),u=id&&S.users.find(x=>x.id==id);return u&&u.st=='active'?u:null}
export async function handle(S,a,p,t,X){
 p=p||{};const now=X.now(),env=X.env,E=(error,msg)=>({r:{ok:false,error,msg:msg||error},dirty:true}),RO=['me','health','otpCheck','userDetail','otpSend'].includes(a),phone=x=>/^9[78]\d{8}$/.test(String(x))?String(x):'',
  lockMsg=c=>c=='locked'?'Too many wrong attempts. Try again in 15 minutes.':'Wrong PIN or password';
 if(!env.SESSION_SECRET||!env.OTP_SECRET)return E('config','Server is not configured: set SESSION_SECRET and OTP_SECRET');
 const chk=async(usr,pin,f)=>{if(usr.lk&&now<usr.lk)return'locked';if(await verify(pin,usr[f])){usr.fails=0;return''}usr.fails=(usr.fails||0)+1;if(usr.fails>=5){usr.lk=now+9e5;usr.fails=0}return'wrong'},
  otpOk=async(ph,code,tok)=>{const[exp,sig]=String(tok||'').split('.');if(!(now<+exp))return'expired';return sig&&sig===await hmac(env.OTP_SECRET,ph+'.'+code+'.'+exp)?'':'invalid'},
  sess=async usr=>{const exp=now+6048e5;return usr.id+'.'+exp+'.'+await hmac(env.SESSION_SECRET,usr.id+'.'+exp)};
 if(a=='otpSend'){const ph=phone(p.phone),ex=S.users.find(x=>x.mobile==ph);if(!ph)return E('bad_phone','Enter a valid 10-digit Nepali mobile number');if(p.mode=='reg'&&ex)return E('exists','This number is already registered');if(p.mode=='fgt'&&!(ex&&ex.role=='player'))return E('none','No player account found');
  if(await X.db.otpCount(ph,now-36e5)>=3)return E('rate','Too many codes requested. Try again in an hour.');await X.db.otpAdd(ph,now);
  const code=r6(),exp=now+3e5,sig=await hmac(env.OTP_SECRET,ph+'.'+code+'.'+exp);
  return{r:{ok:true,token:exp+'.'+sig},dirty:false,after:async()=>(await X.sms(ph,'Club Market OTP: '+code+'. Valid for 5 minutes. Do not share it.'))?0:{error:'sms_failed',msg:'SMS could not be sent. Please try again.'}}}
 if(a=='otpCheck'){const e=await otpOk(phone(p.phone),String(p.code),p.token);return{r:e?{ok:false,error:e,msg:e}:{ok:true},dirty:false}}
 if(a=='register'){const ph=phone(p.phone),e=await otpOk(ph,String(p.code),p.token),n=esc(String(p.name||'').trim());if(e)return E(e,'Invalid or expired code');if(n.length<2||n.length>40)return E('name','Please enter your real name');if(!/^\d{6}$/.test(String(p.pin)))return E('pin','PIN must be 6 digits');if(S.users.some(x=>x.mobile==ph))return E('exists','This number is already registered');
  const usr=NU({id:'u'+rid(),name:n,uname:S.users.some(x=>x.uname.toLowerCase()==n.toLowerCase())?n+' '+ph.slice(-3):n,mobile:ph,role:'player',st:'active',pin:await hashPin(String(p.pin)),t:now});S.users.push(usr);note(S,usr.id,'Welcome to Club Market','Your account is ready. Ask the admin to add points to start.',now);return{r:{ok:true,token:await sess(usr)},dirty:true,u:usr}}
 if(a=='resetPin'){const ph=phone(p.phone),e=await otpOk(ph,String(p.code),p.token),usr=S.users.find(x=>x.mobile==ph&&x.role=='player');if(e||!usr)return E('otp','Invalid or expired code');if(!/^\d{6}$/.test(String(p.pin)))return E('pin','PIN must be 6 digits');usr.pin=await hashPin(String(p.pin));usr.fails=0;usr.lk=0;return{r:{ok:true},dirty:true}}
 if(a=='login'){const id=String(p.id||'').trim().toLowerCase(),usr=id&&S.users.find(x=>x.uname.toLowerCase()==id||x.mobile==id);if(!usr)return E('wrong','Invalid username/mobile or PIN');const c=await chk(usr,String(p.pin||''),'pin');if(c)return E(c,lockMsg(c));if(usr.st!='active')return E('suspended','This account is suspended');return{r:{ok:true,token:await sess(usr)},dirty:true,u:usr}}
 if(a=='setupAdmin'){if(!env.SETUP_KEY||p.key!==env.SETUP_KEY)return E('forbidden','Invalid setup key');if(S.users.some(x=>x.role=='admin'))return E('exists','An admin already exists');const us=esc(String(p.user||'').trim()),pw=String(p.pw||''),op=String(p.op||'');if(us.length<3||pw.length<8||!/^\d{4,6}$/.test(op))return E('bad','Username 3+ characters, password 8+ characters, operation PIN 4-6 digits');S.users.push(NU({id:'a'+rid(),name:esc(String(p.name||us)),uname:us,mobile:'',role:'admin',st:'active',pin:await hashPin(pw),op:await hashPin(op),t:now}));return{r:{ok:true},dirty:true}}
 const u=await authUser(S,t,X);if(!u)return{r:{ok:false,error:'auth',msg:'Please log in again'}};
 const done=(extra,after)=>({r:{ok:true,...extra},dirty:!RO,after,u}),ad=u.role=='admin',E2=async(f,pin)=>{const c=await chk(u,String(pin||''),f);return c?E(c,f=='op'&&c=='wrong'?'Wrong operation PIN':lockMsg(c)):null};
 if(a=='me')return done({});
 if(a=='read'){await X.db.markRead(u.id,String(p.id));return done({})}
 if(a=='readAll'){await X.db.markRead(u.id,null);return done({})}
 if(a=='pushToken'){const tk=String(p.token||'').slice(0,4096);if(tk)await X.db.addToken(u.id,tk,now);return done({})}
 if(a=='changePin'){if(!/^\d{6}$/.test(String(p.pin)))return E('pin','PIN must be 6 digits');const e=await E2('pin',p.cur);if(e)return e;u.pin=await hashPin(String(p.pin));return done({})}
 if(a=='trade'){const c=cb(S,p.club),q=Math.floor(+p.q),b=p.type=='BUY';if(!c||!(q>=1)||!['BUY','SELL'].includes(p.type))return E('bad','Invalid order');const e=await E2('pin',p.pin);if(e)return e;
  const s=S.set,p0=c.price,g=r2(q*p0),fe=r2(g*s.fee/100),h=S.hold.find(x=>x.u==u.id&&x.c==c.id);let gain=0,net;
  if(b){if(!c.act)return E('paused','Trading is paused for this club');if(q<c.min||q>c.max)return E('range','Allowed per purchase: '+c.min+' to '+c.max+' shares');if(q>avail(c))return E('avail','Only '+avail(c)+' shares are available');net=r2(g+fe);if(net>u.bal)return E('funds','Not enough points');
   if(!h)S.hold.push({id:u.id+':'+c.id,u:u.id,c:c.id,q,cost:g});else{h.q+=q;h.cost=r2(h.cost+g)}c.held+=q;u.spent=r2(u.spent+net);u.nbuy++;u.inv=r2(u.inv+g)}
  else{if(!h||q>h.q)return E('own','You do not own that many shares');net=r2(g-fe);const cs=h.cost/h.q*q;gain=r2(g-cs-fe);h.q-=q;h.cost=h.q?r2(h.cost-cs):0;c.held-=q;u.recv=r2(u.recv+net);u.nsell++;u.re=r2(u.re+gain);if(gain>0){u.gains=r2(u.gains+gain);u.nwin++}}
  u.fees=r2(u.fees+fe);u.vol=r2(u.vol+g);const hk=Math.floor(now/HR),hb=c.hb=c.hb||{},bk=hb[hk]=hb[hk]||[0,0,0,0,0];if(b){bk[0]++;bk[2]+=q}else{bk[1]++;bk[3]+=q}bk[4]=r2(bk[4]+g);for(const k in hb)if(+k<hk-336)delete hb[k];
  const tx={id:'CM'+now.toString(36).toUpperCase()+rid().slice(0,3).toUpperCase(),u:u.id,c:c.id,type:p.type,q,p:p0,g,fe,net,gain,t:now,st:'Completed'};S.tx.push(tx);led(S,u,p.type,b?-net:net,(b?'Bought ':'Sold ')+q+' x '+c.name,tx.id,now);
  note(S,u.id,b?'Purchase confirmed':'Sale confirmed',q+' x '+c.name+' at '+r2(p0)+' pts, '+r2(net)+' points',now);c.nb=(c.nb||0)+(b?q:-q);reprice(S,c,{},now);return done({tx})}
 if(!ad)return E('forbidden','Not allowed');
 if(['points','minusWa','suspend','resetUserPin','match','settings','delete'].includes(a)){const e=await E2('op',p.op);if(e)return e}
 const pl=id=>S.users.find(x=>x.id==id&&x.role=='player');
 if(a=='userDetail')return{r:{ok:true,tx:await X.db.userTx(String(p.uid))},dirty:false};
 if(a=='health'){const ch=[],add=(n,s2,d)=>ch.push([n,s2,d]),P=S.users.filter(x=>x.role=='player');let n=P.filter(x=>Math.abs(x.bal-(x.added+x.recv-x.spent))>.01).length;
  add('Wallet integrity',n?'bad':'ok',n?n+' balance(s) do not match their point history':'Every balance matches its point history');
  n=S.clubs.filter(c=>c.held!==S.hold.filter(h=>h.c==c.id).reduce((s2,h)=>s2+h.q,0)).length;add('Share pools',n?'bad':'ok',n?n+' club(s) have a held-share count that differs from holdings':'Held shares match holdings for every club');
  n=S.clubs.filter(c=>c.price<S.set.min||c.price>S.set.max).length;add('Price limits',n?'warn':'ok',n?n+' club(s) outside the min/max price':'All prices are within limits');
  add('Database','ok','Connected: '+S.users.length+' accounts, '+S.clubs.length+' clubs');add('Kusha SMS (OTP)',env.KUSHA_AUTH_TOKEN?'ok':'bad',env.KUSHA_AUTH_TOKEN?'Token is set':'Set KUSHA_AUTH_TOKEN');add('FCM sender',env.FCM_SERVICE_ACCOUNT?'ok':'warn',env.FCM_SERVICE_ACCOUNT?'Service account is set':'FCM_SERVICE_ACCOUNT not set: pushes are not sent');return{r:{ok:true,checks:ch},dirty:false}}
 if(a=='addUser'){const n=esc(String(p.name||'').trim()),us=esc(String(p.user||'').trim()),m=phone(p.mobile);if(n.length<2||us.length<2)return E('bad','Enter a name and username');if(!m)return E('bad','Enter a valid 10-digit Nepali number');if(!/^\d{6}$/.test(String(p.pin)))return E('bad','PIN must be 6 digits');if(S.users.some(x=>x.mobile==m||x.uname.toLowerCase()==us.toLowerCase()))return E('exists','Mobile or username already exists');S.users.push(NU({id:'u'+rid(),name:n,uname:us,mobile:m,role:'player',st:'active',pin:await hashPin(String(p.pin)),t:now}));aud(S,u,'Added user '+n,now);return done({})}
 if(a=='points'){const x=pl(p.uid),am=r2(p.amt);if(!x||!(am>0))return E('bad','Enter an amount above 0');led(S,x,'ISSUE',am,esc(p.why||'')||'Admin added points',u.id,now);x.added=r2(x.added+am);note(S,x.id,'Points added',am+' points were added to your account.',now);aud(S,u,'Added '+am+' points to '+x.uname,now);return done({})}
 if(a=='minusWa'){const x=pl(p.uid),am=r2(p.amt);if(!x||!(am>0))return E('bad','Enter an amount above 0');const w=waOf(x);if(am>w)return E('wa','Cannot deduct more than the available WA Points ('+w+')');x.wadj=r2(x.wadj+am);S.wam.push({id:rid(),u:x.id,amt:am,adm:u.id,why:esc(p.why||''),t:now,wfrom:w,wto:r2(w-am)});note(S,x.id,'WA Points adjusted','WA Points reduced by '+am,now);aud(S,u,'Minus '+am+' WA Points for '+x.uname,now);return done({})}
 if(a=='suspend'){const x=pl(p.uid);if(!x)return E('bad','Invalid user');x.st=x.st=='active'?'suspended':'active';aud(S,u,x.st+' '+x.uname,now);return done({})}
 if(a=='resetUserPin'){const x=pl(p.uid);if(!x)return E('bad','Invalid user');const temp=r6();x.pin=await hashPin(temp);x.fails=0;x.lk=0;aud(S,u,'Reset PIN for '+x.uname,now);return done({temp})}
 if(a=='clubCreate'){const n=esc(String(p.name||'').trim()),pr=+p.price,tt=+p.tot,mi=+p.min,ma=+p.max;if(n.length<2)return E('bad','Enter a club name');if(!(pr>0))return E('bad','Starting price must be above 0');if(!Number.isInteger(tt)||tt<1)return E('bad','Total shares must be a whole number of 1 or more');if(!Number.isInteger(mi)||!Number.isInteger(ma)||mi<1||ma<1)return E('bad','Minimum and maximum must be whole numbers of 1 or more');if(mi>ma)return E('bad','Minimum cannot be greater than maximum');if(ma>tt)return E('bad','Maximum cannot exceed total shares');if(S.clubs.some(c=>c.name.toLowerCase()==n.toLowerCase()))return E('exists','This club already exists');
  const id='c'+rid();S.clubs.push({id,name:n,ab:(n.replace(/[^A-Za-z ]/g,'').split(' ').filter(Boolean).map(w=>w[0]).join('').slice(0,3).toUpperCase())||'FC',col:'#246CB4',logo:/^https:\/\//.test(p.logo||'')?p.logo:'',act:1,d:'',tot:tt,min:mi,max:ma,nb:0,held:0,price:r2(pr),p0:r2(pr),bp:r2(pr),bt:now,lt:now,hb:{},t:now});
  S.ph.push({id:rid(),c:id,t:now,p:r2(pr),prev:null,pct:null,why:'Initial virtual price',mid:null,opp:null,res:null,comp:'',adm:u.id,mp:0,dp:0});aud(S,u,'Created club '+n,now);return done({})}
 if(a=='clubToggle'){const c=cb(S,p.id);if(!c)return E('bad','Invalid club');c.act=c.act?0:1;aud(S,u,(c.act?'Activated ':'Deactivated ')+c.name,now);return done({})}
 if(a=='match'){const rs=(id,n)=>{if(id&&id!='__x'){const c=cb(S,id);return c?{c,n:c.name}:null}const x=esc(String(n||'').trim());return x.length>=2&&x.length<=40?{x,n:x}:null},L=rs(p.a,p.ea),R=rs(p.b,p.eb);
  if(!L||!R)return E('bad','Choose both clubs. For a club that is not listed, type its name.');if(!L.c&&!R.c)return E('bad','At least one club must be a registered club');if(L.c&&L.c==R.c)return E('bad','Choose two different clubs');
  if([L,R].some(z=>z.x&&S.clubs.some(c=>c.name.toLowerCase()==z.x.toLowerCase())))return E('bad','That club is already registered. Pick it from the list instead.');
  const comp=esc(String(p.comp||'').trim()).slice(0,60),date=String(p.date||''),sa=Math.floor(+p.sa),sb=Math.floor(+p.sb);if(!(sa>=0&&sb>=0&&sa<100&&sb<100))return E('bad','Enter the final score (0 to 99 goals each)');if(!/^\d{4}-\d{2}-\d{2}$/.test(date))return E('bad','Choose the match date');
  const res=sa>sb?'A':sb>sa?'B':'D';if(p.res!==res)return E('bad','The result does not match the score '+sa+'-'+sb+'. Check the score or the result.');
  const m={id:'m'+rid(),a:L.c?L.c.id:null,b:R.c?R.c.id:null,an:L.n,bn:R.n,comp,mdate:date,sa,sb,res,notes:esc(p.notes||'').slice(0,200),dd:[L.c?L.c.id:'x:'+L.x.toLowerCase(),R.c?R.c.id:'x:'+R.x.toLowerCase(),date,comp.toLowerCase()].join('|'),adm:u.id,t:now},
   s=S.set,rt={A:[s.win,s.loss],B:[s.loss,s.win],D:[s.draw,s.draw]}[res],W={A:['Won against','Lost to'],B:['Lost to','Won against'],D:['Drew with','Drew with']}[res],out=[];S.matches.push(m);
  [[L,R,sa,sb],[R,L,sb,sa]].forEach(([me,op,g1,g2],i)=>{if(!me.c)return;const c=me.c,pv=c.price;reprice(S,c,{mp:rt[i]+(s.gd||0)*(g1-g2),why:W[i]+' '+op.n+' '+g1+'-'+g2,opp:op.n,res:res=='D'?'Drew':((res=='A')==(i==0)?'Won':'Lost'),comp,mid:m.id,adm:u.id},now);out.push(me.n+' '+r2(pv)+' -> '+r2(c.price))});
  S.users.filter(x=>x.role=='player').forEach(x=>note(S,x.id,'Match result',L.n+' '+sa+'-'+sb+' '+R.n+(comp?' ('+comp+')':'')+'. Simulated prices: '+out.join(', '),now));aud(S,u,'Processed match '+L.n+' vs '+R.n,now);return done({note:s.auto?'Match saved. Prices updated':'Match saved. Automatic pricing is OFF'})}
 if(a=='settings'){const k=['win','draw','loss','cap','min','max','fee','dem','dcap','day','gd'],n={};for(const x of k)n[x]=+p[x];n.auto=+p.auto?1:0;if(k.some(x=>isNaN(n[x]))||n.min<=0||n.max<=n.min||n.cap<0||n.fee<0||n.fee>20||n.dem<0||n.dcap<0||n.day<=0||n.gd<0||n.gd>5)return E('bad','Check the values: minimum below maximum, fee 0 to 20%');Object.assign(S.set,n);aud(S,u,'Updated pricing and commission settings',now);return done({})}
 if(a=='adminUsername'){const e=await E2('pin',p.pw);if(e)return e;const n=esc(String(p.user||'').trim());if(n.length<3)return E('bad','Username is too short');if(S.users.some(x=>x.id!=u.id&&x.uname.toLowerCase()==n.toLowerCase()))return E('exists','Username is taken');u.uname=n;aud(S,u,'Changed username',now);return done({})}
 if(a=='adminPassword'){const e=await E2('pin',p.cur);if(e)return e;if(String(p.pw||'').length<8)return E('bad','Use at least 8 characters');u.pin=await hashPin(String(p.pw));aud(S,u,'Changed password',now);return done({})}
 if(a=='adminOp'){const e=await E2('op',p.cur);if(e)return e;if(!/^\d{4,6}$/.test(String(p.pin)))return E('bad','PIN must be 4-6 digits');u.op=await hashPin(String(p.pin));aud(S,u,'Changed operation PIN',now);return done({})}
 if(a=='broadcast'){const ti=esc(String(p.title||'').trim()).slice(0,80),mg=esc(String(p.msg||'').trim()).slice(0,500),P=S.users.filter(x=>x.role=='player'),all=p.to==='all',to=all?P.map(x=>x.id):[...new Set((Array.isArray(p.to)?p.to:[]).filter(i=>P.some(x=>x.id==i)))];if(!ti||!mg)return E('bad','Enter a title and a message');if(!to.length)return E('bad','Select at least one recipient');
  const id=rid();S.bc.push({id,t:now,title:ti,msg:mg,allu:all?1:0,rcp:to,adm:u.id,push:'Pending'});to.forEach(i=>note(S,i,ti,mg,now,id));aud(S,u,'Sent notification "'+ti+'" to '+to.length+' user(s)',now);const toks=await X.db.tokens(to);
  return done({note:'Saved in-app for '+to.length+' user(s)'},async()=>{const o=toks.length?await X.push(toks,ti,mg):{state:'No registered devices',bad:[]};return{patch:async X2=>{await X2.db.setPush(id,o.state);await X2.db.delTokens(o.bad||[])}}})}
 if(a=='delete'){const k=p.k,i=String(p.id);let lab=i;
  if(k=='user'){const x=pl(i);if(!x)return E('bad','Invalid user');lab=x.uname;S.hold.filter(h=>h.u==i).forEach(h=>{const c=cb(S,h.c);if(c)c.held-=h.q});S.hold=S.hold.filter(h=>h.u!=i);S.users=S.users.filter(y=>y.id!=i)}
  else if(k=='club'){const c=cb(S,i);if(!c)return E('bad','Invalid club');if(S.clubs.length<=2)return E('bad','Keep at least two clubs');if(c.held>0||await X.db.clubHasTx(i))return E('bad','This club has holdings or transactions. Deactivate it instead.');lab=c.name;S.clubs=S.clubs.filter(y=>y.id!=i)}
  else if(k=='match')S._del.matches.push(i);
  else if(k=='note')S._del.broadcasts.push(i);
  else return E('bad','Unknown type');aud(S,u,'Deleted '+k+': '+lab,now);return done({})}
 return E('bad','Unknown action')}
export async function run(a,p,t,X){
 for(let i=0;i<8;i++){const S=await X.db.core();norm(S);for(const k in TB2)S[k]=[];snap(S);
  const o=await handle(S,a,p,t,X),ch=o.dirty?diff(S):null;
  if(ch){try{await X.db.commit(ch)}catch(e){const m=String(e&&e.message||e);if(/conflict/.test(m)){await new Promise(r=>setTimeout(r,10+Math.random()*50*(i+1)));continue}if(/duplicate key/i.test(m))return{ok:false,error:'dup',msg:/matches_dd/.test(m)?'This result was already processed':'That username, mobile number or name already exists'};throw e}}
  if(o.after){const e=await o.after();if(e&&e.error)return{ok:false,error:e.error,msg:e.msg};if(e&&e.patch)await e.patch(X)}
  const r=o.r;if(r.ok&&o.u)r.view=await buildView(S,o.u,X);return r}
 return{ok:false,error:'busy',msg:'The server is busy. Please try again.'}}
// ---- Supabase data access (small, indexed queries only) ----
const num=r=>{for(const k of['q','p','g','fe','net','gain','amt','b','t'])if(r[k]!=null)r[k]=+r[k];return r};
export const mkDb=db=>{const sel=async q=>{const{data,error}=await q;if(error)throw new Error(error.message);return data},ex=async q=>{const{error}=await q;if(error)throw new Error(error.message)},rv=a=>a.slice().reverse(),cnt=async q=>{const{count,error}=await q;if(error)throw new Error(error.message);return count||0};
 return{
  core:async()=>{const[users,clubs,hold,set]=await Promise.all([sel(db.from('profiles').select('*')),sel(db.from('clubs').select('*')),sel(db.from('holdings').select('*')),sel(db.from('settings').select('*').eq('id',1).single())]);return{users,clubs,hold,set}},
  version:async()=>(await sel(db.from('meta').select('v').eq('id',1).single())).v,
  commit:async ch=>{const{error}=await db.rpc('fn_commit',{p:ch});if(error)throw new Error(error.message+' ['+(error.code||'')+']')},
  hist:since=>sel(db.from('price_history').select('c,t,p,prev,pct,why,res,comp').gte('t',since).order('t',{ascending:true}).limit(8000)),
  matches:async()=>rv(await sel(db.from('matches').select('*').order('t',{ascending:false}).limit(100))).map(r=>({id:r.id,a:r.a,b:r.b,an:r.an,bn:r.bn,comp:r.comp,date:r.mdate,sa:r.sa,sb:r.sb,res:r.res,notes:r.notes,t:+r.t})),
  rows:async(uid,ad)=>{const lim=(t,n)=>{let q=db.from(t).select('*');if(!ad)q=q.eq('u',uid);return sel(q.order('t',{ascending:false}).limit(n))};
   const[tx,led,notes,wam,tk]=await Promise.all([lim('transactions',ad?200:100),lim('ledger',100),ad?[]:lim('notifications',100),lim('wa_adjust',100),cnt(ad?db.from('device_tokens').select('u',{count:'exact',head:true}):db.from('device_tokens').select('u',{count:'exact',head:true}).eq('u',uid))]);
   let bc=[],aud=[];if(ad){const b=await sel(db.from('broadcasts').select('*').order('t',{ascending:false}).limit(20)),rd=b.length?await sel(db.from('notifications').select('bc,r').in('bc',b.map(x=>x.id))):[];aud=rv(await sel(db.from('audit_logs').select('*').order('t',{ascending:false}).limit(50))).map(num);bc=rv(b).map(x=>({id:x.id,t:+x.t,title:x.title,msg:x.msg,all:!!x.allu,to:x.rcp,adm:x.adm,push:x.push,rd:rd.filter(y=>y.bc==x.id&&y.r).length}))}
   return{tx:rv(tx).map(num),led:rv(led).map(num),notes:rv(notes).map(num),wam:rv(wam).map(num),bc,aud,tk}},
  userTx:async uid=>(await sel(db.from('transactions').select('*').eq('u',uid).order('t',{ascending:false}).limit(50))).map(num),
  otpCount:(m,since)=>cnt(db.from('otp_log').select('id',{count:'exact',head:true}).eq('mobile',m).gte('t',since)),
  otpAdd:(m,t)=>ex(db.from('otp_log').insert({id:crypto.randomUUID(),mobile:m,t})),
  tokens:async ids=>ids.length?(await sel(db.from('device_tokens').select('tk').in('u',ids))).map(x=>x.tk):[],
  addToken:(u,tk,t)=>ex(db.from('device_tokens').upsert({u,tk,t},{onConflict:'u,tk'})),
  delTokens:l=>l.length?ex(db.from('device_tokens').delete().in('tk',l)):0,
  markRead:(u,id)=>{let q=db.from('notifications').update({r:1}).eq('u',u);if(id)q=q.eq('id',id);return ex(q)},
  setPush:(id,s)=>ex(db.from('broadcasts').update({push:s}).eq('id',id)),
  clubHasTx:async id=>(await cnt(db.from('transactions').select('id',{count:'exact',head:true}).eq('c',id)))>0}};
export function mkX(env){return{env,now:()=>Date.now(),
 sms:async(ph,text)=>{const r=await fetch('https://kushasms.com/sms/v4/send-user',{method:'POST',headers:{'auth-token':env.KUSHA_AUTH_TOKEN||'','Content-Type':'application/json'},body:JSON.stringify({to:[ph],text:[text]})}).catch(()=>null),j=r?await r.json().catch(()=>null):null;return!!(r&&r.ok&&j&&j.responses&&j.responses[0]&&!j.responses[0].error)},
 push:async(tokens,title,body)=>{try{if(!env.FCM_SERVICE_ACCOUNT)return{state:'Not configured (no FCM_SERVICE_ACCOUNT)',bad:[]};const sa=JSON.parse(env.FCM_SERVICE_ACCOUNT),iat=Math.floor(Date.now()/1e3),h=o=>b64(enc.encode(JSON.stringify(o))),inp=h({alg:'RS256',typ:'JWT'})+'.'+h({iss:sa.client_email,scope:'https://www.googleapis.com/auth/firebase.messaging',aud:'https://oauth2.googleapis.com/token',iat,exp:iat+3600}),
  key=await crypto.subtle.importKey('pkcs8',Uint8Array.from(atob(sa.private_key.replace(/-----[^-]+-----|\s/g,'')),c=>c.charCodeAt(0)),{name:'RSASSA-PKCS1-v1_5',hash:'SHA-256'},false,['sign']),sig=b64(new Uint8Array(await crypto.subtle.sign('RSASSA-PKCS1-v1_5',key,enc.encode(inp)))),
  tr=await fetch('https://oauth2.googleapis.com/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:'grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion='+inp+'.'+sig}),at=(await tr.json()).access_token;if(!at)return{state:'FCM authentication failed',bad:[]};
  let ok=0;const bad=[];await Promise.all(tokens.map(async tk=>{const r=await fetch('https://fcm.googleapis.com/v1/projects/'+sa.project_id+'/messages:send',{method:'POST',headers:{Authorization:'Bearer '+at,'Content-Type':'application/json'},body:JSON.stringify({message:{token:tk,notification:{title,body}}})}).catch(()=>null);if(r&&r.ok)ok++;else if(r&&(r.status==404||r.status==400))bad.push(tk)}));return{state:'Accepted by FCM for '+ok+' of '+tokens.length+' device(s)',bad}}catch(e){return{state:'Push failed',bad:[]}}}}}
if(typeof Deno!=='undefined'){
 const{createClient}=await import('npm:@supabase/supabase-js@2'),env=Deno.env.toObject(),db=createClient(env.SUPABASE_URL,env.SUPABASE_SERVICE_ROLE_KEY,{auth:{persistSession:false}}),X={...mkX(env),db:mkDb(db)},
  H={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'authorization, x-client-info, apikey, content-type','Content-Type':'application/json'},J=(o,s=200)=>new Response(JSON.stringify(o),{status:s,headers:H}),
  logo=async d=>{const m=/^data:image\/(webp|png|jpeg);base64,(.+)$/.exec(d||'');if(!m)return'';const bin=Uint8Array.from(atob(m[2]),c=>c.charCodeAt(0));if(bin.length>3e5)return'';const n='c'+Date.now().toString(36)+'.'+(m[1]=='jpeg'?'jpg':m[1]),{error}=await db.storage.from('club-logos').upload(n,bin,{contentType:'image/'+m[1],upsert:true});return error?'':db.storage.from('club-logos').getPublicUrl(n).data.publicUrl};
 Deno.serve(async req=>{if(req.method=='OPTIONS')return new Response('ok',{headers:H});
  try{const{a,p,t}=await req.json();
   if(a=='me'&&p&&p.v!=null&&await tokenOk(t,X)&&String(await X.db.version())===String(p.v))return J({ok:true,same:true});
   if(a=='clubCreate'&&p&&p.logo){const au=await authUser(norm2(await X.db.core()),t,X);p.logo=au&&au.role=='admin'?await logo(p.logo):''}
   return J(await run(a,p,t,X))
  }catch(e){console.error(e);return J({ok:false,error:'server',msg:'Server error'},500)}})}
function norm2(S){norm(S);return S}
