import WebSocket from 'ws';
import { EmbedBuilder } from 'discord.js';
import db from './database.js';
import { getStreams, getTwitchUser, getLatestArchiveVod } from './twitch.js';

db.exec(`
CREATE TABLE IF NOT EXISTS chatlog_settings (guild_id TEXT PRIMARY KEY, channel_id TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS chatlog_channels (name TEXT PRIMARY KEY);
CREATE TABLE IF NOT EXISTS chatlog_watches (guild_id TEXT NOT NULL, username TEXT NOT NULL, channel_name TEXT NOT NULL, PRIMARY KEY(guild_id,username,channel_name));
CREATE TABLE IF NOT EXISTS chatlog_messages (message_id TEXT PRIMARY KEY, channel_name TEXT, sent_at TEXT, raw_json TEXT);
`);
const channels = () => db.prepare('SELECT DISTINCT channel_name AS name FROM chatlog_watches ORDER BY channel_name').all().map(x=>x.name);
const targets = (username,channel) => db.prepare('SELECT s.guild_id,s.channel_id FROM chatlog_settings s JOIN chatlog_watches w ON s.guild_id=w.guild_id WHERE w.username=? AND w.channel_name=?').all(username,channel);
const watchedUsers = () => new Set(db.prepare('SELECT DISTINCT username FROM chatlog_watches').all().map(x=>x.username));
const normalize = name => {const value=String(name).trim().toLowerCase().replace(/^https?:\/\/(www\.)?twitch\.tv\//,'').replace(/^[@#]/,'').replace(/\/.*$/,'');if(!/^[a-z0-9_]{3,25}$/.test(value))throw Error('Invalid Twitch name');return value;};
const getLast = db.prepare('SELECT channel_name,sent_at FROM chatlog_messages ORDER BY sent_at DESC LIMIT 1');
const addMessage = db.prepare('INSERT OR IGNORE INTO chatlog_messages VALUES (?,?,?,?)');
let ws, reconnectTimer, alive = false;
const lastHeaders = new Map();
let queue = Promise.resolve();
const delay = ms => new Promise(resolve=>setTimeout(resolve,ms));
const unescapeTag = s => (s||'').replace(/\\([snr\\:])/g, (_,x)=>({s:' ',n:'\n',r:'\r','\\':'\\',':':';'}[x]));
function parse(line) {
  if (!line.startsWith('@')) return null;
  const i=line.indexOf(' '); if(i<0)return null;
  const tags=Object.fromEntries(line.slice(1,i).split(';').map(p=>{const k=p.indexOf('=');return [p.slice(0,k),unescapeTag(p.slice(k+1))]}));
  const match=line.slice(i+1).match(/^:([^! ]+)!.* PRIVMSG #([^ ]+) :([\s\S]*)$/);
  return match ? {tags, login:match[1].toLowerCase(), channel:match[2].toLowerCase(), text:match[3]} : null;
}
function clock(date) { return new Intl.DateTimeFormat('en-US',{timeZone:'America/New_York',hour:'numeric',minute:'2-digit',second:'2-digit',hour12:true}).format(date); }
function uptime(ms){const s=Math.floor(ms/1000);return `${Math.floor(s/3600)}:${String(Math.floor(s%3600/60)).padStart(2,'0')}:${String(s%60).padStart(2,'0')}`;}
function safeText(s){return (s||'').replace(/@everyone|@here|<@!?\d+>|<@&\d+>/g,m=>'\\'+m);}
function badges(tags){const list=(tags.badges||'').split(',').map(s=>s.split('/')[0]);const out=[];if(list.includes('vip')&&process.env.CHATLOG_VIP_EMOJI)out.push(process.env.CHATLOG_VIP_EMOJI);if((list.includes('partner')||list.includes('verified'))&&process.env.CHATLOG_PARTNER_EMOJI)out.push(process.env.CHATLOG_PARTNER_EMOJI);return out.join(' ');}
async function handleMessage(m,client){
  if(!watchedUsers().has(m.login))return;
  const destinations=targets(m.login,m.channel);if(!destinations.length)return;
  const id=m.tags.id;if(!id)return;
  const date=new Date(Number(m.tags['tmi-sent-ts']||Date.now()));if(Number.isNaN(+date))return;
  const inserted=addMessage.run(id,m.channel,date.toISOString(),JSON.stringify(m));if(!inserted.changes)return;
  const headerKey=`${m.login}:${m.channel}`;
  const previous=lastHeaders.get(headerKey);
  const header=!previous || +date-previous>30*60*1000 || +date<previous;
  lastHeaders.set(headerKey,+date);
  let start=null, vod=null;
  try {
    const user=await getTwitchUser(m.channel);
    if(user){const streams=await getStreams([user.id]);const stream=streams[0];if(stream?.started_at && +new Date(stream.started_at)<=+date)start=new Date(stream.started_at);
      if(header)vod=await getLatestArchiveVod(user.id,date).catch(()=>null);
    }
  }catch(e){console.warn('Chatlog stream metadata:',e.message)}
  const time=`${start?uptime(+date-start):'—'} / ${clock(date)}`;
  const replyName=m.tags['reply-parent-display-name']||m.tags['reply-parent-user-login'];
  const replyText=m.tags['reply-parent-msg-body'];
  let description='';
  if(replyName){description+=`↳ Replying to **${safeText(replyName)}**${replyText!=null?`:\n> ${safeText(replyText).replace(/\n/g,'\n> ')}`:''}\n`}
  description+=`${safeText(m.text)}\n-# ${time}`;
  // Optional width hint: Discord chooses embed width; this is not pixel-perfect.
  // Keep padding short and on its own line to avoid large/invalid descriptions.
  const unpaddedDescription=description;
  const pad='\u2800'.repeat(32);
  if(description.length+pad.length+1<=4096)description+=`\n${pad}`;
  const color=/^#[0-9a-fA-F]{6}$/.test(m.tags.color||'')?m.tags.color:'#9146FF';
  const embeds=[];
  if(header){const name=`${m.tags['display-name']||m.login} ${badges(m.tags)} in #${m.channel}${vod?' · VOD':''}`.trim();
    const e=new EmbedBuilder().setColor(color).setDescription(description.slice(0,4096)).setTimestamp(date).setTitle(name.slice(0,256));
    if(vod)e.setURL(`https://www.twitch.tv/videos/${vod}`);embeds.push(e);
  }else embeds.push(new EmbedBuilder().setColor(color).setDescription(description.slice(0,4096)).setTimestamp(date));
  // Discord embeds have a 4096-character description limit. Keep the remainder, including complete replies.
  if(description.length>4096){let rest=description.slice(4096);while(rest.length){embeds.push(new EmbedBuilder().setColor(color).setDescription(rest.slice(0,4096)));rest=rest.slice(4096)}}
  for(const t of destinations){
    try {const ch=await client.channels.fetch(t.channel_id);if(ch?.send)await ch.send({embeds,allowedMentions:{parse:[]}})}
    catch(e){
      console.error('Chatlog Discord send:',e.message);
      // If Discord rejects the padded embed, retry without padding.
      try {
        const ch=await client.channels.fetch(t.channel_id);
        if(ch?.send){
          const plain=embeds.map((embed,i)=>{
            const copy=EmbedBuilder.from(embed);
            if(i===0)copy.setDescription(unpaddedDescription.slice(0,4096));
            return copy;
          });
          await ch.send({embeds:plain,allowedMentions:{parse:[]}});
          console.warn('Chatlog: delivered without padding after initial send failed');
        }
      }catch(retryError){console.error('Chatlog fallback send:',retryError.message)}
    }
  }
}
function connect(client){
  const token=(process.env.TWITCH_CHAT_OAUTH_TOKEN||'').replace(/^oauth:/,'');
  const nick=(process.env.TWITCH_CHAT_BOT_USERNAME||'').toLowerCase();
  if(!token||!nick){console.log('Chatlog disabled: TWITCH_CHAT_OAUTH_TOKEN and TWITCH_CHAT_BOT_USERNAME required');return}
  if(ws&&[WebSocket.CONNECTING,WebSocket.OPEN].includes(ws.readyState))return;
  ws=new WebSocket('wss://irc-ws.chat.twitch.tv:443');
  ws.on('open',async()=>{alive=true;ws.send(`PASS oauth:${token}`);ws.send(`NICK ${nick}`);ws.send('CAP REQ :twitch.tv/tags twitch.tv/commands twitch.tv/membership');for(const name of channels()){ws.send(`JOIN #${name}`);await delay(180)}});
  ws.on('message',buf=>{for(const line of String(buf).split('\r\n')){
    if(line.startsWith('PING')){ws.send(line.replace('PING','PONG'));continue}
    if(line.includes('Login authentication failed'))console.error('Twitch chat OAuth authentication failed');
    const m=parse(line);if(m)queue=queue.then(()=>handleMessage(m,client)).catch(e=>console.error('Chatlog:',e));
  }});
  ws.on('error',e=>console.error('Chatlog websocket:',e.message));
  ws.on('close',()=>{alive=false;clearTimeout(reconnectTimer);reconnectTimer=setTimeout(()=>connect(client),10000)});
}
export function startChatlog(client){connect(client)}
export function chatlogSetup(guildId,channelId){db.prepare('INSERT INTO chatlog_settings VALUES (?,?) ON CONFLICT(guild_id) DO UPDATE SET channel_id=excluded.channel_id').run(guildId,channelId)}
export function chatlogAdd(guildId,username,channelName){
  username=normalize(username);channelName=normalize(channelName);
  const old=channels();if(old.length>=100&&!old.includes(channelName))throw Error('100-channel cap reached');
  db.prepare('INSERT OR IGNORE INTO chatlog_watches VALUES (?,?,?)').run(guildId,username,channelName);
  if(!old.includes(channelName)&&ws?.readyState===WebSocket.OPEN)ws.send(`JOIN #${channelName}`);
}
export function chatlogRemove(guildId,username,channelName){
  username=normalize(username);channelName=normalize(channelName);
  db.prepare('DELETE FROM chatlog_watches WHERE guild_id=? AND username=? AND channel_name=?').run(guildId,username,channelName);
  if(!channels().includes(channelName)&&ws?.readyState===WebSocket.OPEN)ws.send(`PART #${channelName}`);
}
export function chatlogList(guildId){return db.prepare('SELECT username,channel_name FROM chatlog_watches WHERE guild_id=? ORDER BY username,channel_name').all(guildId);}

// Remove every watched user/chat pair for one Discord server, leaving the output channel unchanged.
export function chatlogNuke(guildId){
  const before=channels();
  const result=db.prepare('DELETE FROM chatlog_watches WHERE guild_id=?').run(guildId);
  const remaining=new Set(channels());
  if(ws?.readyState===WebSocket.OPEN){
    for(const name of before){if(!remaining.has(name))ws.send(`PART #${name}`)}
  }
  return result.changes;
}
