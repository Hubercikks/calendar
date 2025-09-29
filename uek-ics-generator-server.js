const express = require('express');
const fetch = require('node-fetch');
const cheerio = require('cheerio');
const { DateTime } = require('luxon');
const { v4: uuidv4 } = require('uuid');

const app = express();
const PORT = process.env.PORT || 3000;
const DEFAULT_URL = 'https://planzajec.uek.krakow.pl/index.php?typ=G&id=187131&okres=2';
const TIMEZONE = 'Europe/Warsaw';

function clean(s) {
  return (s || '').replace(/\s+/g,' ').trim();
}

// --- Elastyczny parser tekstowy ---
function parseSchedulePage(html) {
  const $ = cheerio.load(html);
  const text = $('body').text();
  const lines = text.split(/\n/).map(clean).filter(Boolean);
  const events = [];

  // Regex do wychwycenia linii z datą i godziną
  const re = /^(\d{4}-\d{2}-\d{2})\s+\S+\s+(\d{2}:\d{2})\s*-\s*(\d{2}:\d{2})\s*(.*)$/;

  lines.forEach(line => {
    const m = line.match(re);
    if (!m) return;

    const date = m[1];
    const start = m[2];
    const end = m[3];
    let rest = clean(m[4]);

    // Heurystycznie wydzielamy typ zajęć (wykład, ćwiczenia, laboratorium, etc.)
    let type = '';
    const typeWords = ['wykład','ćwiczenia','konwersatorium','lektorat','rezerwacja','ćw.','seminarium','lab.'];
    for(const tw of typeWords){
      const idx = rest.toLowerCase().indexOf(' ' + tw + ' ');
      if(idx !== -1){
        type = tw;
        rest = clean(rest.slice(0, idx)) + ' ' + tw;
        break;
      }
    }

    // Heurystycznie wydzielamy nauczyciela i salę
    let teacher = '';
    let room = '';
    const parts = rest.split(/\s{2,}|\t/).map(clean).filter(Boolean);
    if(parts.length >= 2){
      teacher = parts[parts.length-2];
      room = parts[parts.length-1];
    }

    const title = rest;

    events.push({ date, start, end, title, type, teacher, room });
  });

  return events;
}

function buildICS(events){
  const lines = ['BEGIN:VCALENDAR','VERSION:2.0','PRODID:-//UEK-ICS//PL','CALSCALE:GREGORIAN','METHOD:PUBLISH'];

  for(const ev of events){
    try{
      const dtStart = DateTime.fromISO(ev.date+'T'+ev.start,{zone:TIMEZONE});
      const dtEnd = DateTime.fromISO(ev.date+'T'+ev.end,{zone:TIMEZONE});
      const fmt = dt=>dt.toFormat("yyyyLLdd'T'HHmmss");
      const uid = uuidv4()+'@uek-ics';

      lines.push('BEGIN:VEVENT');
      lines.push('UID:'+uid);
      lines.push('DTSTAMP:'+DateTime.utc().toFormat("yyyyLLdd'T'HHmmss'Z'"));
      lines.push('DTSTART;TZID='+TIMEZONE+':'+fmt(dtStart));
      lines.push('DTEND;TZID='+TIMEZONE+':'+fmt(dtEnd));
      lines.push('SUMMARY:'+(ev.title||'').replace(/[\n\r,]/g,' '));
      lines.push('DESCRIPTION:' + ['Typ: '+ev.type,'Prowadzacy: '+ev.teacher,'Sala: '+ev.room,'Źródło: planzajec.uek.krakow.pl'].join(' \\n '));
      lines.push('LOCATION:'+(ev.room||'').replace(/[\n\r,]/g,' '));
      lines.push('END:VEVENT');
    }catch(e){ console.error(e,ev); }
  }

  lines.push('END:VCALENDAR');
  return lines.join('\r\n');
}

// --- Endpoint ICS ---
app.get('/calendar.ics', async (req,res)=>{
  const sourceUrl = req.query.url || DEFAULT_URL;
  try{
    const r = await fetch(sourceUrl, { headers:{'User-Agent':'UEK-ICS'} });
    if(!r.ok) return res.status(502).send('Bad upstream response');
    const html = await r.text();
    const events = parseSchedulePage(html);
    if(!events.length) return res.status(500).send('No events parsed');
    const ics = buildICS(events);
    res.setHeader('Content-Type','text/calendar; charset=utf-8');
    res.send(ics);
  }catch(err){
    console.error(err);
    res.status(500).send('Error: '+err.message);
  }
});

app.get('/',(req,res)=>{
  res.send('<h3>UEK ICS Generator</h3><p>Endpoint: <a href="/calendar.ics">/calendar.ics</a></p>');
});

app.listen(PORT,'0.0.0.0',()=>console.log('Server running on port',PORT));
