const express = require('express');
const fetch = require('node-fetch');
const cheerio = require('cheerio');
const { DateTime } = require('luxon');
const { v4: uuidv4 } = require('uuid');

const app = express();
const PORT = process.env.PORT || 3000;

const DEFAULT_URL = '[https://planzajec.uek.krakow.pl/index.php?typ=G&id=187131&okres=2](https://planzajec.uek.krakow.pl/index.php?typ=G&id=187131&okres=2)';
const TIMEZONE = 'Europe/Warsaw';

function clean(s){ return (s||'').replace(/\s+/g,' ').trim(); }

// Updated parser for new UEK HTML table layout
function parseSchedulePage(html){
const $ = cheerio.load(html);
const events = [];

$('table.table.table-bordered tr').each((_, row) => {
const cells = $(row).find('td');
if(cells.length >= 6){
const date = clean($(cells[0]).text());
const timeRange = clean($(cells[1]).text());
const subject = clean($(cells[2]).text());
const type = clean($(cells[3]).text());
const teacher = clean($(cells[4]).text());
const room = clean($(cells[5]).text());

```
  const timeMatch = timeRange.match(/(\d{2}:\d{2})\s*-\s*(\d{2}:\d{2})/);
  if(!timeMatch) return;

  const start = timeMatch[1];
  const end = timeMatch[2];

  events.push({date,start,end,title:subject,type,teacher,room});
}
```

});

return events;
}

function buildICS(events){
const lines = [];
lines.push('BEGIN:VCALENDAR','VERSION:2.0','PRODID:-//UEK-ICS-Generator//pl','CALSCALE:GREGORIAN','METHOD:PUBLISH');

for(const ev of events){
try{
const dtStart = DateTime.fromISO(ev.date+'T'+ev.start,{zone:TIMEZONE});
const dtEnd = DateTime.fromISO(ev.date+'T'+ev.end,{zone:TIMEZONE});
const fmt = dt=>dt.toFormat("yyyyLLdd'T'HHmmss");
const uid = uuidv4()+'@uek-ics-generator';

```
  lines.push('BEGIN:VEVENT',
    'UID:'+uid,
    'DTSTAMP:'+DateTime.utc().toFormat("yyyyLLdd'T'HHmmss'Z'"),
    'DTSTART;TZID='+TIMEZONE+':'+fmt(dtStart),
    'DTEND;TZID='+TIMEZONE+':'+fmt(dtEnd),
    'SUMMARY:'+ev.title.replace(/[\n\r,]/g,' '),
    'DESCRIPTION:' + ['Typ: '+ev.type,'Prowadzacy: '+ev.teacher,'Sala: '+ev.room,'Źródło: planzajec.uek.krakow.pl'].join(' \n '),
    'LOCATION:'+ev.room.replace(/[\n\r,]/g,' '),
    'END:VEVENT'
  );
}catch(e){console.error('Event build error',e,ev);}
```

}

lines.push('END:VCALENDAR');
return lines.join('\r\n');
}

app.get('/calendar.ics', async (req,res)=>{
try{
const r = await fetch(DEFAULT_URL,{headers:{'User-Agent':'UEK-ICS-Generator/1.0'}});
if(!r.ok) return res.status(502).send('Bad upstream response');
const html = await r.text();
const events = parseSchedulePage(html);
if(events.length===0) return res.status(500).send('No events parsed from source page');
res.setHeader('Content-Type','text/calendar; charset=utf-8');
res.send(buildICS(events));
}catch(err){
console.error(err);
res.status(500).send('Error: '+err.message);
}
});

app.get('/',(req,res)=>{
res.send(`<h3>UEK ICS generator</h3><p>Endpoint: <a href="/calendar.ics">/calendar.ics</a></p><p>To use different plan URL: <code>/calendar.ics?url=ENCODED_URL</code></p>`);
});

app.listen(PORT,'0.0.0.0',()=>console.log('Server running on port',PORT));
