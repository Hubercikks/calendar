const fetch = require('node-fetch');
const { DateTime } = require('luxon');
const { v4: uuidv4 } = require('uuid');

const DEFAULT_URL = 'https://planzajec.uek.krakow.pl/index.php?typ=G&id=187131&okres=2&format=json';
const TIMEZONE = 'Europe/Warsaw';

function clean(s) {
  return (s || '').replace(/\s+/g, ' ').trim();
}

function buildICS(events) {
  const lines = [];
  lines.push('BEGIN:VCALENDAR');
  lines.push('VERSION:2.0');
  lines.push('PRODID:-//UEK-ICS-Generator//PL');
  lines.push('CALSCALE:GREGORIAN');
  lines.push('METHOD:PUBLISH');

  events.forEach(ev => {
    try {
      const dtStart = DateTime.fromISO(ev.date + 'T' + ev.start, { zone: TIMEZONE });
      const dtEnd = DateTime.fromISO(ev.date + 'T' + ev.end, { zone: TIMEZONE });
      const fmt = dt => dt.toFormat("yyyyLLdd'T'HHmmss");
      const uid = uuidv4() + '@uek-ics';

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
      console.error('Error building event', e, ev);
    }
  });

  lines.push('END:VCALENDAR');
  return lines.join('\r\n');
}

async function fetchAndGenerateICS(url = DEFAULT_URL) {
  try {
    const response = await fetch(url);
    if (!response.ok) throw new Error('Failed to fetch data');

    const data = await response.json();
    const events = data.map(item => ({
      date: item.date,
      start: item.start,
      end: item.end,
      title: item.subject,
      type: item.type,
      teacher: item.teacher,
      room: item.room
    }));

    if (!events.length) throw new Error('No events found');

    const ics = buildICS(events);
    return ics;
  } catch (error) {
    console.error('Error:', error);
  }
}

fetchAndGenerateICS().then(ics => {
  if (ics) {
    console.log('Generated ICS file:');
    console.log(ics);
  }
});
