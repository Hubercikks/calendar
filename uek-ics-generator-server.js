/*
UEK schedule -> ICS generator (Node.js + Express + Puppeteer)
*/

const express = require('express');
const puppeteer = require('puppeteer');
const cheerio = require('cheerio');
const { DateTime } = require('luxon');
const { v4: uuidv4 } = require('uuid');

const app = express();
const PORT = process.env.PORT || 3000;

const DEFAULT_URL = 'https://planzajec.uek.krakow.pl/index.php?typ=G&id=187131&okres=2';
const TIMEZONE = 'Europe/Warsaw';

// --- Helpers ---
function clean(s) {
  return (s || '').replace(/\s+/g, ' ').trim();
}

// --- Parser dla tabeli UEK ---
function parseSchedulePage(html) {
  const $ = cheerio.load(html);
  const events = [];

  $('table.table.table-bordered tr').each((_, row) => {
    const cells = $(row).find('td');
    if (cells.length >= 6) {
      const date = clean($(cells[0]).text());
      const timeRange = clean($(cells[1]).text());
      const subject = clean($(cells[2]).text());
      const type = clean($(cells[3]).text());
      const teacher = clean($(cells[4]).text());
      const room = clean($(cells[5]).text());

      const timeMatch = timeRange.match(/(\d{2}:\d{2})\s*-\s*(\d{2}:\d{2})/);
      if (!timeMatch) return;

      const start = timeMatch[1];
      const end = timeMatch[2];

      events.push({ date, start, end, title: subject, type, teacher, room });
    }
  });

  return events;
}

// --- Budowanie ICS ---
function buildICS(events) {
  const lines = [];
  lines.push('BEGIN:VCALENDAR');
  lines.push('VERSION:2.0');
  lines.push('PRODID:-//UEK-ICS-Generator//pl');
  lines.push('CALSCALE:GREGORIAN');
  lines.push('METHOD:PUBLISH');

  for (const ev of events) {
    try {
      const dtStart = DateTime.fromISO(ev.date + 'T' + ev.start, { zone: TIMEZONE });
      const dtEnd = DateTime.fromISO(ev.date + 'T' + ev.end, { zone: TIMEZONE });
      const fmt = dt => dt.toFormat("yyyyLLdd'T'HHmmss");
      const uid = uuidv4() + '@uek-ics-generator';

      lines.push('BEGIN:VEVENT');
      lines.push('UID:' + uid);
      lines.push('DTSTAMP:' + DateTime.utc().toFormat("yyyyLLdd'T'HHmmss'Z'"));
      lines.push('DTSTART;TZID=' + TIMEZONE + ':' + fmt(dtStart));
      lines.push('DTEND;TZID=' + TIMEZONE + ':' + fmt(dtEnd));
      lines.push('SUMMARY:' + (ev.title || '').replace(/[\n\r,]/g, ' '));
      lines.push('DESCRIPTION:' + ['Typ: ' + ev.type, 'Prowadzacy: ' + ev.teacher, 'Sala: ' + ev.room, 'Źródło: planzajec.uek.krakow.pl'].join(' \\n '));
      lines.push('LOCATION:' + (ev.room || '').replace(/[\n\r,]/g, ' '));
      lines.push('END:VEVENT');
    } catch (e) {
      console.error('Event build error', e, ev);
    }
  }

  lines.push('END:VCALENDAR');
  return lines.join('\r\n');
}

// --- Endpoint ICS z Puppeteer ---
app.get('/calendar.ics', async (req, res) => {
  const sourceUrl = req.query.url || DEFAULT_URL;
  try {
    const browser = await puppeteer.launch({ args: ['--no-sandbox'] });
    const page = await browser.newPage();
    await page.goto(sourceUrl, { waitUntil: 'networkidle0' });

    const html = await page.content();
    await browser.close();

    const events = parseSchedulePage(html);
    if (events.length === 0) return res.status(500).send('No events parsed from source page');

    const ics = buildICS(events);
    res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
    res.send(ics);

  } catch (err) {
    console.error(err);
    res.status(500).send('Error: ' + err.message);
  }
});

// --- Root UI ---
app.get('/', (req, res) => {
  res.send(`
    <h3>UEK ICS generator</h3>
    <p>Endpoint: <a href="/calendar.ics">/calendar.ics</a></p>
    <p>To use different plan URL: <code>/calendar.ics?url=ENCODED_URL</code></p>
  `);
});

// --- Start server ---
app.listen(PORT, '0.0.0.0', () => {
  console.log('Server running on port', PORT);
});
