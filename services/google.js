// services/google.js
import { google } from 'googleapis';
import { ENV, TZ_OFFSET } from '../config/config.js';
import fs from 'fs';

/**
 * Autenticación:
 * - Producción: variable de entorno GOOGLE_CREDENTIALS con el JSON completo.
 * - Local: archivo service-account.json en la raíz.
 */
let credentials;
if (process.env.GOOGLE_CREDENTIALS) {
  try {
    credentials = JSON.parse(process.env.GOOGLE_CREDENTIALS);
  } catch (e) {
    console.error('❌ GOOGLE_CREDENTIALS no es un JSON válido.');
    throw e;
  }
} else {
  try {
    credentials = JSON.parse(fs.readFileSync('service-account.json', 'utf8'));
  } catch (e) {
    console.error('❌ No encontré service-account.json y no existe GOOGLE_CREDENTIALS.');
    throw e;
  }
}

const auth = new google.auth.GoogleAuth({
  credentials,
  scopes: [
    'https://www.googleapis.com/auth/spreadsheets',
    'https://www.googleapis.com/auth/calendar',
  ],
});

export const sheets   = google.sheets({ version: 'v4', auth });
export const calendar = google.calendar({ version: 'v3', auth });

/* ───────────── Helpers Sheets ───────────── */
function padRow(r, n = 14) {
  const out = Array(n).fill('');
  for (let i = 0; i < Math.min(n, r.length); i++) out[i] = r[i];
  return out;
}

export async function appendRow(values) {
  await sheets.spreadsheets.values.append({
    spreadsheetId: ENV.SHEET_ID,
    range: 'appointments!A:N',
    valueInputOption: 'USER_ENTERED',
    requestBody: { values: [values] },
  });
}

export async function getAllRows() {
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: ENV.SHEET_ID,
    range: 'appointments!A:N',
  });
  const raw = res.data.values || [];
  return raw.map(r => padRow(r, 14));
}

export async function updateRow(rowNum, values) {
  await sheets.spreadsheets.values.update({
    spreadsheetId: ENV.SHEET_ID,
    range: `appointments!A${rowNum}:N${rowNum}`,
    valueInputOption: 'USER_ENTERED',
    requestBody: { values: [values] },
  });
}

/* Leads (hoja "leads" A:E) */
export async function appendLead(values) {
  await sheets.spreadsheets.values.append({
    spreadsheetId: ENV.SHEET_ID,
    range: 'leads!A:E',
    valueInputOption: 'USER_ENTERED',
    requestBody: { values: [values] },
  });
}

/* ───────────── Helpers Calendar ───────────── */

export async function createCalendarEvent(
  summary,
  isoStart,
  {
    durationMin = 30,
    colorId,
    description,
    location,
    apptKey,
    attendees = [],
    reminders = [
      { method: 'popup', minutes: 60 },
      { method: 'popup', minutes: 10 },
    ],
  } = {}
) {
  const start = new Date(isoStart);
  const end = new Date(start.getTime() + durationMin * 60 * 1000);

  await calendar.events.insert({
    calendarId: ENV.CALENDAR_ID,
    requestBody: {
      summary,
      location,
      description,
      start: { dateTime: isoStart, timeZone: 'America/Tijuana' },
      end:   { dateTime: end.toISOString(), timeZone: 'America/Tijuana' },
      ...(colorId ? { colorId } : {}),
      ...(attendees.length ? { attendees } : {}),
      ...(apptKey ? { extendedProperties: { private: { apptKey } } } : {}),
      reminders: { useDefault: false, overrides: reminders },
    },
  });
}

export async function listCalendarEventsByDate(dateISO /* 'YYYY-MM-DD' */) {
  const timeMin = `${dateISO}T00:00:00${TZ_OFFSET}`;
  const timeMax = `${dateISO}T23:59:59${TZ_OFFSET}`;

  const { data } = await calendar.events.list({
    calendarId: ENV.CALENDAR_ID,
    timeMin,
    timeMax,
    singleEvents: true,
    maxResults: 2500,
  });

  return data.items || [];
}

export async function findEventByKey(apptKey) {
  const { data } = await calendar.events.list({
    calendarId: ENV.CALENDAR_ID,
    privateExtendedProperty: `apptKey=${apptKey}`,
    singleEvents: true,
    maxResults: 1,
  });
  return (data.items || [])[0] || null;
}

export async function rescheduleByKey(
  apptKey,
  newISO,
  { summary, durationMin = 30, colorId, description, location } = {}
) {
  const ev = await findEventByKey(apptKey);
  if (!ev) return;

  const end = new Date(new Date(newISO).getTime() + durationMin * 60 * 1000).toISOString();

  await calendar.events.patch({
    calendarId: ENV.CALENDAR_ID,
    eventId: ev.id,
    requestBody: {
      ...(summary ? { summary } : {}),
      ...(location ? { location } : {}),
      ...(description ? { description } : {}),
      start: { dateTime: newISO, timeZone: 'America/Tijuana' },
      end:   { dateTime: end,    timeZone: 'America/Tijuana' },
      ...(colorId ? { colorId } : {}),
    },
  });
}

export async function deleteByKey(apptKey) {
  const ev = await findEventByKey(apptKey);
  if (ev) {
    await calendar.events.delete({
      calendarId: ENV.CALENDAR_ID,
      eventId: ev.id,
    });
  }
}
