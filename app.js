/*
UEK schedule -> ICS generator (Node.js + Express)

How it works:
- Fetches the UEK schedule page (the URL you provided) each time /calendar.ics is requested
- Parses visible text to extract date, start/end times, subject, teacher, room
- Builds an iCalendar (.ics) feed and returns it with Content-Type: text/calendar

Usage:
1) Install dependencies:
   npm init -y
   npm install express node-fetch@2 cheerio luxon uuid

2) Run:
   node uek-ics-generator-server.js

3) Deploy somewhere public (Heroku / Railway / Vercel (serverless) / VPS).

4) In Google Calendar: "Add other calendars" -> "From URL" -> paste https://YOUR_DOMAIN/calendar.ics
   Google will periodically fetch this URL and update the calendar.

Notes & limitations:
- This is a pragmatic parser based on the current page layout. If UEK changes HTML, the parser may need tweaks.
- Google Calendar refresh interval is controlled by Google (usually every few hours). You can't force immediate refresh from the server side.
- For more robust usage, add caching, logging, and error handling; consider supporting multiple groups via query params.

*/

const express = require('express');
const fetch = require('node-fetch');
const cheerio = require('cheerio');
const { DateTime } = require('luxon');
const { v4: uuidv4 } = require('uuid');

const app = express();
const PORT = process.env.PORT || 3000;

// === CONFIG ===
// Default schedule URL (you gave this one)
const DEFAULT_URL = 'https://planzajec.uek.krakow.pl/index.php?typ=G&id=187131&okres=2';
const TIMEZONE = 'Europe/Warsaw';
// ==============

// Helper: normalize whitespace
function clean(s){
  return (s || '').replace(/\s+/g,' ').trim();
}

// Parse schedule page text and extract events
function parseSchedulePage(html){
  const $ = cheerio.load(html);

  // The page contains lines like: "2025-10-07 Wt 09:45 - 11:15 (2g.) Metody inwestowania ćwiczenia dr Oleksij Kelebaj Paw.A 014"
  // We'll collect all text nodes that look like a leading date YYYY-MM-DD

  const bodyText = $('body').text();
  const lines = bodyText.split(/\n/).map(l=>clean(l)).filter(Boolean);

  const events = [];

  const re = /^(\d{4}-\d{2}-\d{2})\s+\S+\s+(\d{2}:\d{2})\s*-\s*(\d{2}:\d{2})\s*\([^)]*\)\s+(.*)$/;
  // group 1: date, 2: start, 3: end, 4: rest (subject + type + teacher + room...)

  for(const line of lines){
    const m = line.match(re);
    if(m){
      const date = m[1];
      const start = m[2];
      const end = m[3];
      const rest = clean(m[4]);

      // Try to heuristically split rest into title, type, teacher, room
      // We'll look for known type words (wykład, ćwiczenia, konwersatorium, lektorat, rezerwacja, seminaryum)
      const typeWords = ['wykład','ćwiczenia','konwersatorium','lektorat','rezerwacja','ćw.','seminarium','lab.'];
      let type = '';
      let title = rest;
      for(const tw of typeWords){
        const idx = rest.toLowerCase().indexOf(' ' + tw + ' ');
        if(idx !== -1){
          title = clean(rest.slice(0, idx));
          type = tw;
          break;
        }
      }

      // Extract teacher / room from leftover
      // Very rough: try to take last chunk after multiple spaces
      const parts = rest.split(/\s{2,}|\t/).map(p=>clean(p)).filter(Boolean);
      let teacher = '';
      let room = '';
      if(parts.length >= 2){
        // often: "Subject type teacher Room"
        teacher = parts[1];
        room = parts.slice(2).join(' ');
      } else {
        // fallback: look for 'Paw.' or 'Sala' in the rest
        const roomMatch = rest.match(/(Paw\.[^\s,;]+|Sala[^\s,;]+|sala [^,]+)/i);
        if(roomMatch) room = roomMatch[0];
      }

      // Title fallback
      if(!title) title = rest;

      events.push({date,start,end,title,type,teacher,room,raw:line});
    }
  }

  return events;
}

// Convert events to ICS string
function buildICS(events){
  const lines = [];
  lines.push('BEGIN:VCALENDAR');
  lines.push('VERSION:2.0');
  lines.push('PRODID:-//UEK-ICS-Generator//pl');
  lines.push('CALSCALE:GREGORIAN');
  lines.push('METHOD:PUBLISH');

  for(const ev of events){
    try{
      const dtStart = DateTime.fromISO(ev.date + 'T' + ev.start, {zone: TIMEZONE});
      const dtEnd = DateTime.fromISO(ev.date + 'T' + ev.end, {zone: TIMEZONE});

      // format as UTC or with TZID; to be safe use DTSTART;TZID=Europe/Warsaw:YYYYMMDDTHHMMSS
      const fmt = (dt)=>dt.toFormat("yyyyLLdd'T'HHmmss");

      const uid = uuidv4() + '@uek-ics-generator';

      lines.push('BEGIN:VEVENT');
      lines.push('UID:' + uid);
      lines.push('DTSTAMP:' + DateTime.utc().toFormat("yyyyLLdd'T'HHmmss'Z'"));
      lines.push('DTSTART;TZID=' + TIMEZONE + ':' + fmt(dtStart));
      lines.push('DTEND;TZID=' + TIMEZONE + ':' + fmt(dtEnd));
      lines.push('SUMMARY:' + (ev.title || '').replace(/[,\n\r]/g,' '));

      const descParts = [];
      if(ev.type) descParts.push('Typ: ' + ev.type);
      if(ev.teacher) descParts.push('Prowadzacy: ' + ev.teacher);
      if(ev.room) descParts.push('Sala: ' + ev.room);
      descParts.push('Źródło: planzajec.uek.krakow.pl');

      lines.push('DESCRIPTION:' + descParts.join(' \n '));
      if(ev.room) lines.push('LOCATION:' + ev.room.replace(/[,\n\r]/g,' '));
      lines.push('END:VEVENT');
    }catch(e){
      console.error('Event build error', e, ev);
    }
  }

  lines.push('END:VCALENDAR');
  return lines.join('\r\n');
}

app.get('/calendar.ics', async (req, res) =>{
  const sourceUrl = req.query.url || DEFAULT_URL;
  try{
    const r = await fetch(sourceUrl, {headers: {'User-Agent':'UEK-ICS-Generator/1.0'}});
    if(!r.ok) return res.status(502).send('Bad upstream response');
    const html = await r.text();

    const events = parseSchedulePage(html);

    if(events.length === 0){
      return res.status(500).send('No events parsed from source page (layout may have changed).');
    }

    const ics = buildICS(events);
    res.setHeader('Content-Type','text/calendar; charset=utf-8');
    // recommended to allow Google to fetch directly; don't force download
    res.send(ics);
  }catch(err){
    console.error(err);
    res.status(500).send('Error: ' + String(err.message));
  }
});

// Simple root UI with instructions
app.get('/', (req,res)=>{
  res.send(`<h3>UEK ICS generator</h3>
  <p>Endpoint: <code>/calendar.ics</code></p>
  <p>Example: <a href="/calendar.ics">/calendar.ics</a></p>
  <p>To use different plan URL: <code>/calendar.ics?url=ENCODED_URL</code></p>
  <p>Then add the full URL to Google Calendar (Other calendars &uarr; From URL)</p>
  `);
});

app.listen(PORT, ()=>{
  console.log('Server running on port', PORT);
});
