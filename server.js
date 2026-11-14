const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const PORT = Number(process.env.PORT || 3000);
const AUCTION_MS = 15000;
const CLUBS = new Set(['Real Madrid','Barcelona','Manchester City','Liverpool','Arsenal','Manchester United','Chelsea','Bayern Munich','Paris Saint-Germain','AC Milan','Inter Miami','Other']);
const ROOT = __dirname;
const rooms = new Map();
const playerDetailsCache = new Map();
const cards = [
  ['Lionel Messi','Inter Miami','Forward',10,'LM','#8b5cf6'],['Cristiano Ronaldo','Al Nassr','Forward',10,'CR','#e7a83e'],['Kylian Mbappé','Real Madrid','Forward',9,'KM','#e94262'],['Erling Haaland','Manchester City','Forward',9,'EH','#35a978'],
  ['Jude Bellingham','Real Madrid','Midfielder',9,'JB','#e0a53a'],['Kevin De Bruyne','Manchester City','Midfielder',9,'KD','#38a5c7'],['Luka Modrić','Real Madrid','Midfielder',8,'LM','#9672ce'],['Rodri','Manchester City','Midfielder',9,'R','#42a884'],
  ['Virgil van Dijk','Liverpool','Defender',9,'VD','#d2634f'],['Rúben Dias','Manchester City','Defender',8,'RD','#497bc1'],['William Saliba','Arsenal','Defender',8,'WS','#cb6582'],['Trent Alexander-Arnold','Liverpool','Defender',8,'TA','#388f80'],
  ['Alisson Becker','Liverpool','Goalkeeper',9,'AB','#bd7b37'],['Thibaut Courtois','Real Madrid','Goalkeeper',9,'TC','#5375bd'],['Ederson','Manchester City','Goalkeeper',8,'E','#29a18e'],['Emiliano Martínez','Aston Villa','Goalkeeper',8,'EM','#9e66bd'],
  ['Vinícius Júnior','Real Madrid','Forward',9,'VJ','#de664f'],['Bukayo Saka','Arsenal','Forward',8,'BS','#c18a36'],['Martin Ødegaard','Arsenal','Midfielder',8,'MO','#5083c8'],['Federico Valverde','Real Madrid','Midfielder',8,'FV','#50a77a'],
  ['Antonio Rüdiger','Real Madrid','Defender',8,'AR','#a9688b'],['Joško Gvardiol','Manchester City','Defender',8,'JG','#397daa'],['Mike Maignan','AC Milan','Goalkeeper',8,'MM','#a87637'],['Harry Kane','Bayern Munich','Forward',9,'HK','#5e79c1']
].map(([name,club,role,rating,initials,color],i)=>({id:`p${i}`,name,club,role,rating,initials,color}));
const uid = () => crypto.randomBytes(12).toString('hex');
const code = () => crypto.randomBytes(3).toString('hex').toUpperCase();
const cleanName = s => String(s || '').trim().replace(/[<>]/g,'').slice(0,20);
async function enrichCard(card){
  if(!card||card.dataSource)return;
  if(playerDetailsCache.has(card.name)){Object.assign(card,playerDetailsCache.get(card.name));return;}
  try{
    const res=await fetch(`https://www.thesportsdb.com/api/v1/json/123/searchplayers.php?p=${encodeURIComponent(card.name)}`,{signal:AbortSignal.timeout(2500)});
    if(!res.ok)return;const data=await res.json();const p=data.player?.find(x=>x.strPlayer?.toLowerCase()===card.name.toLowerCase())||data.player?.[0];
    const extra=p?{photo:p.strCutout||p.strThumb||null,nationality:p.strNationality||null,dataSource:'TheSportsDB'}:{dataSource:'TheSportsDB'};
    playerDetailsCache.set(card.name,extra);Object.assign(card,extra);
  }catch{}
}
function publicRoom(room, pid) {
  const bids = room.bids || {};
  return { code:room.code, state:room.state, hostId:room.hostId, you:pid,
    players:room.players.map(p=>({id:p.id,name:p.name,club:p.club,coins:p.coins,roster:p.roster,connected:Date.now()-p.lastSeen<7000,host:p.id===room.hostId,submitted:!!bids[p.id]})),
    round:room.round, totalRounds:8, card:room.card, deadline:room.deadline,
    lastResult:room.lastResult, winner:room.winner, message:room.message, finalScores:room.finalScores||{} };
}
function settle(room) {
  if (room.state !== 'playing' || !room.deadline || Date.now() < room.deadline) return;
  const submitted=Object.entries(room.bids).filter(([id,b])=>room.players.some(p=>p.id===id)&&b>0);
  submitted.sort((a,b)=>b[1]-a[1]);
  let won=null;
  if(submitted.length){
    const top=submitted.filter(x=>x[1]===submitted[0][1]);
    top.sort((a,b)=>{
      const pa=room.players.find(p=>p.id===a[0]),pb=room.players.find(p=>p.id===b[0]);
      return pa.roster.length-pb.roster.length || pb.coins-pa.coins || (room.players.indexOf(pa)-room.players.indexOf(pb));
    }); won=top[0];
  }
  if(won){const p=room.players.find(p=>p.id===won[0]);p.coins-=won[1];p.roster.push(room.card);room.lastResult={text:`${p.name} won ${room.card.name} for ${won[1]} coins`,playerId:p.id,card:room.card,bid:won[1]};}
  else room.lastResult={text:`${room.card.name} went unsold`,card:room.card};
  room.round++;room.bids={};
  if(room.round>8){finish(room);return;}
  if(room.players.length<2){room.state='finished';room.winner=room.players[0]?.id;room.message=`${room.players[0]?.name || 'The remaining player'} wins by forfeit.`;return;}
  room.card=room.deck[room.round-1];room.deadline=Date.now()+AUCTION_MS;enrichCard(room.card);
}
function finish(room){
  room.state='finished';room.deadline=null;
  const score=p=>p.roster.reduce((s,c)=>s+c.rating,0)+(new Set(p.roster.map(c=>c.role)).size===4?5:0);
  room.players.sort((a,b)=>score(b)-score(a)||b.coins-a.coins);
  room.winner=room.players[0]?.id;room.message='Auction complete. Final scores include +5 for a complete set of four roles.';
  room.finalScores=Object.fromEntries(room.players.map(p=>[p.id,score(p)]));
}
function json(res,obj,status=200){res.writeHead(status,{'Content-Type':'application/json','Access-Control-Allow-Origin':'*','Cache-Control':'no-store'});res.end(JSON.stringify(obj));}
function body(req){return new Promise((resolve,reject)=>{let s='';req.on('data',c=>s+=c);req.on('end',()=>{try{resolve(JSON.parse(s||'{}'))}catch(e){reject(e)}})});}
const server=http.createServer(async(req,res)=>{
  const url=new URL(req.url,`http://${req.headers.host}`);
  if(req.method==='OPTIONS'){res.writeHead(204,{'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'Content-Type','Access-Control-Allow-Methods':'GET,POST,OPTIONS'});return res.end();}
  try{
    if(req.method==='POST'&&url.pathname==='/api/create'){
      const b=await body(req), name=cleanName(b.name)||'Player',club=String(b.club||'');if(!CLUBS.has(club))return json(res,{error:'Choose your club first.'},400);let c;do{c=code()}while(rooms.has(c));
      const p={id:uid(),name,club,coins:100,roster:[],lastSeen:Date.now()};const room={code:c,hostId:p.id,players:[p],state:'lobby',round:0,deck:[],card:null,deadline:null,bids:{},lastResult:null,winner:null};rooms.set(c,room);return json(res,{...publicRoom(room,p.id)});
    }
    if(req.method==='POST'&&url.pathname==='/api/join'){
      const b=await body(req),room=rooms.get(String(b.code||'').toUpperCase());if(!room)return json(res,{error:'Room code not found.'},404);if(room.state!=='lobby')return json(res,{error:'This room has already started.'},409);if(room.players.length>=4)return json(res,{error:'This room is full.'},409);const club=String(b.club||'');if(!CLUBS.has(club))return json(res,{error:'Choose your club first.'},400);
      const p={id:uid(),name:cleanName(b.name)||'Player',club,coins:100,roster:[],lastSeen:Date.now()};room.players.push(p);return json(res,publicRoom(room,p.id));
    }
    if(req.method==='GET'&&url.pathname==='/api/featured'){
      const featured=[cards[0],cards[2],cards[1]];await Promise.all(featured.map(enrichCard));return json(res,featured.map(({name,photo,initials,rating,color})=>({name,photo,initials,rating,color})));
    }
    const match=url.pathname.match(/^\/api\/room\/([A-Z0-9]+)(?:\/(start|bid|heartbeat))?$/);
    if(match){const [,c,action]=match,room=rooms.get(c);if(!room)return json(res,{error:'Room not found.'},404);
      if(req.method==='GET'&&!action){const pid=url.searchParams.get('pid');const p=room.players.find(p=>p.id===pid);if(!p)return json(res,{error:'Player not in room.'},403);p.lastSeen=Date.now();settle(room);return json(res,publicRoom(room,pid));}
      if(req.method==='POST'&&action){const b=await body(req),p=room.players.find(p=>p.id===b.pid);if(!p)return json(res,{error:'Player not in room.'},403);p.lastSeen=Date.now();
        if(action==='heartbeat')return json(res,{ok:true});
        if(action==='start'){if(room.hostId!==p.id)return json(res,{error:'Only the room host can start.'},403);if(room.players.length<2)return json(res,{error:'At least 2 players are required.'},400);if(room.state!=='lobby')return json(res,{error:'The game has already started.'},409);room.deck=[...cards].sort(()=>Math.random()-.5).slice(0,8);room.round=1;room.card=room.deck[0];enrichCard(room.card);room.deadline=Date.now()+AUCTION_MS;room.state='playing';room.lastResult=null;return json(res,publicRoom(room,p.id));}
        if(action==='bid'){settle(room);if(room.state!=='playing')return json(res,{error:'Bidding is closed.'},409);if(Date.now()>room.deadline)return json(res,{error:'Time is up.'},409);if(room.bids[p.id]!==undefined)return json(res,{error:'Your bid is already locked.'},409);if(p.roster.length>=4)return json(res,{error:'Your roster is full.'},400);const amount=Number(b.amount);if(!Number.isInteger(amount)||amount<0||amount>p.coins)return json(res,{error:'Bid must be between 0 and your remaining coins.'},400);room.bids[p.id]=amount;return json(res,publicRoom(room,p.id));}
      }
    }
    const leaveMatch=url.pathname.match(/^\/api\/room\/([A-Z0-9]+)\/leave$/);
    if(req.method==='POST'&&leaveMatch){const room=rooms.get(leaveMatch[1]);if(!room)return json(res,{ok:true});const b=await body(req);const p=room.players.find(p=>p.id===b.pid);if(!p)return json(res,{ok:true});room.players=room.players.filter(x=>x.id!==p.id);delete room.bids[p.id];if(room.state==='playing'&&room.players.length<2){room.state='finished';room.deadline=null;room.winner=room.players[0]?.id;room.message=`${room.players[0]?.name||'A remaining player'} wins by forfeit.`;}else if(room.state==='playing'){room.message=`${p.name} left the auction. The game continues.`;}return json(res,{ok:true});}
    if(req.method==='GET'&&(url.pathname==='/'||url.pathname==='/index.html')){res.writeHead(200,{'Content-Type':'text/html; charset=utf-8'});return fs.createReadStream(path.join(ROOT,'index.html')).pipe(res);}
    if(req.method==='GET'&&url.pathname==='/app.js'){res.writeHead(200,{'Content-Type':'text/javascript; charset=utf-8'});return fs.createReadStream(path.join(ROOT,'app.js')).pipe(res);}
    if(req.method==='GET'&&url.pathname==='/style.css'){res.writeHead(200,{'Content-Type':'text/css; charset=utf-8'});return fs.createReadStream(path.join(ROOT,'style.css')).pipe(res);}
    if(req.method==='GET'&&url.pathname==='/favicon.svg'){res.writeHead(200,{'Content-Type':'image/svg+xml; charset=utf-8','Cache-Control':'public, max-age=86400'});return fs.createReadStream(path.join(ROOT,'favicon.svg')).pipe(res);}
    json(res,{error:'Not found.'},404);
  }catch(e){json(res,{error:'Request failed.'},400);}
});
setInterval(()=>{for(const room of rooms.values()){if(room.state==='playing'){for(const p of [...room.players])if(Date.now()-p.lastSeen>12000){room.players=room.players.filter(x=>x.id!==p.id);delete room.bids[p.id];if(room.players.length<2){room.state='finished';room.deadline=null;room.winner=room.players[0]?.id;room.message=`${room.players[0]?.name||'A remaining player'} wins by forfeit.`;break;}}settle(room);}}},1000);
server.listen(PORT,'0.0.0.0',()=>console.log(`Auction Arena running on http://localhost:${PORT}`));
