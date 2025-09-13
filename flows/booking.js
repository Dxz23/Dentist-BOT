// flows/booking.js
import {
  PROCEDURES, PRE_APPT_PDF_URL, POST_APPT_PDF_URL, CLINIC, SHEET_COL, TZ_OFFSET, PROC_DETAILS,
  PROC_DURATION_MIN, PROC_COLOR_ID
} from '../config/config.js';
import {
  sendMessage,
  buildListMessage,
  buildButtonMessage,
  buildLocation,
  buildDocument,
  normalizePhone
} from '../services/wa.js';
import {
  appendRow,
  createCalendarEvent,
  updateRow,
  getAllRows,
  listCalendarEventsByDate,
  // nuevas por key:
  rescheduleByKey,
  deleteByKey
} from '../services/google.js';

/* ───── Config ───── */
const hours = ['09:00', '13:00', '17:00'];

/* ───── Helpers ───── */
const UPGRADE_BROADCAST = 3;
const UPGRADE_LOOKAHEAD_DAYS = 2;
function sameDate(isoA, isoB) { return isoA.slice(0,10) === isoB.slice(0,10); }
function shuffle(a){for(let i=a.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[a[i],a[j]]=[a[j],a[i]];}return a;}
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function getUpgradeCandidates(cancelISO) {
  const rows = await getAllRows();
  const cancelTs = new Date(cancelISO).getTime();

  const isOk = r =>
    r[SHEET_COL.STATUS] === 'CONFIRMADA' &&
    r[SHEET_COL.DATETIME] &&
    new Date(r[SHEET_COL.DATETIME]).getTime() > Date.now();

  const sameDayLater = rows
    .filter(isOk)
    .filter(r => sameDate(r[SHEET_COL.DATETIME], cancelISO))
    .filter(r => new Date(r[SHEET_COL.DATETIME]).getTime() > cancelTs)
    .sort((a,b) => new Date(a[SHEET_COL.DATETIME]) - new Date(b[SHEET_COL.DATETIME]));

  const extras = [];
  for (let d = 1; d <= UPGRADE_LOOKAHEAD_DAYS; d++) {
    const dayISO = new Date(cancelISO);
    dayISO.setDate(dayISO.getDate() + d);
    const dayStr = dayISO.toISOString().slice(0,10);
    const chunk = rows
      .filter(isOk)
      .filter(r => r[SHEET_COL.DATETIME].startsWith(dayStr))
      .sort((a,b) => new Date(a[SHEET_COL.DATETIME]) - new Date(b[SHEET_COL.DATETIME]));
    extras.push(...chunk);
  }
  return [...sameDayLater, ...extras];
}

export async function proposeUpgradeToWaitlist(cancelISO) {
  const rows = await getAllRows();
  const occupiedSheet = rows.some(r => r[SHEET_COL.DATETIME] === cancelISO && r[SHEET_COL.STATUS] !== 'CANCELADA');
  const calEvents = await listCalendarEventsByDate(cancelISO.slice(0,10));
  const slotStart = new Date(cancelISO);
  const slotEnd = new Date(slotStart.getTime() + 30*60*1000);
  const occupiedCal = calEvents.some(ev => {
    const evStart = new Date(ev.start?.dateTime || `${ev.start?.date}T00:00:00${TZ_OFFSET}`);
    const evEnd   = new Date(ev.end?.dateTime   || `${ev.end?.date}T23:59:59${TZ_OFFSET}`);
    return slotStart < evEnd && slotEnd > evStart;
  });
  if (occupiedSheet || occupiedCal) return;

  const candidates = await getUpgradeCandidates(cancelISO);
  if (!candidates.length) return;
  const top = candidates.slice(0, UPGRADE_BROADCAST);

  for (const r of top) {
    const to = normalizePhone(r[SHEET_COL.PHONE]);
    const lang = r[SHEET_COL.LANG] || 'es';
    const procKey = r[SHEET_COL.PROCEDURE];

    const newLabel = new Date(cancelISO).toLocaleString(lang==='en'?'en-US':'es-MX', {
      weekday:'short', day:'numeric', month:'short', hour:'2-digit', minute:'2-digit', hour12:true
    }).replace(/\./g,'');

    const oldLabel = new Date(r[SHEET_COL.DATETIME]).toLocaleString(lang==='en'?'en-US':'es-MX', {
      weekday:'short', day:'numeric', month:'short', hour:'2-digit', minute:'2-digit', hour12:true
    }).replace(/\./g,'');

    const body = (lang==='en'
      ? [
          '⚡ *A slot opened up!*',
          '',
          `We can move your *${PROCEDURES[procKey][lang]}* to *${newLabel}* (earlier than your current *${oldLabel}*).`,
          '',
          'Do you want to take it?'
        ].join('\n')
      : [
          '⚡ *Se liberó un espacio*',
          '',
          `Podemos adelantar tu *${PROCEDURES[procKey][lang]}* a *${newLabel}* (antes de tu cita actual *${oldLabel}*).`,
          '',
          '¿Te gustaría tomarlo?'
        ].join('\n')
    );

    const buttons = [
      { type:'reply', reply:{ id:`upgrade_accept__${cancelISO}__${r[SHEET_COL.DATETIME]}`, title:(lang==='en'?'✅ Tomarlo':'✅ Tomarlo') } },
      { type:'reply', reply:{ id:`upgrade_skip__${cancelISO}__${r[SHEET_COL.DATETIME]}`,   title:(lang==='en'?'No, thanks':'No gracias') } }
    ];

    await sendMessage(buildButtonMessage({ to, body, buttons }));
  }
}

/* ─────────── OLAS (8 min) ─────────── */
const UPGRADE_OLAS = new Map();
const UPGRADE_DEFAULT_PER_WAVE = 3;
const UPGRADE_DEFAULT_DELAY_MIN = 8;

async function isSlotFree(iso){
  const rows = await getAllRows();
  const takenSheet = rows.some(r => r[SHEET_COL.DATETIME] === iso && r[SHEET_COL.STATUS] !== 'CANCELADA');
  if (takenSheet) return false;

  const evs = await listCalendarEventsByDate(iso.slice(0,10));
  const s = new Date(iso), e = new Date(s.getTime()+30*60*1000);
  return !evs.some(ev=>{
    const es = new Date(ev.start?.dateTime || `${ev.start?.date}T00:00:00${TZ_OFFSET}`);
    const ee = new Date(ev.end  ?.dateTime || `${ev.end  ?.date}T23:59:59${TZ_OFFSET}`);
    return s < ee && e > es;
  });
}

async function getBuckets(cancelISO, lookaheadDays=1){
  const rows = await getAllRows();
  const cancelTs = new Date(cancelISO).getTime();

  const isFutureConfirmed = r =>
    r[SHEET_COL.STATUS] === 'CONFIRMADA' &&
    r[SHEET_COL.DATETIME] &&
    new Date(r[SHEET_COL.DATETIME]).getTime() > Date.now();

  const sameDayLater = rows
    .filter(isFutureConfirmed)
    .filter(r => sameDate(r[SHEET_COL.DATETIME], cancelISO))
    .filter(r => new Date(r[SHEET_COL.DATETIME]).getTime() > cancelTs)
    .sort((a,b)=> new Date(a[SHEET_COL.DATETIME]) - new Date(b[SHEET_COL.DATETIME]));

  const mk = d => { const x=new Date(cancelISO); x.setDate(x.getDate()+d); return x.toISOString().slice(0,10); };

  const d1 = rows.filter(isFutureConfirmed).filter(r=>r[SHEET_COL.DATETIME].startsWith(mk(1)))
    .sort((a,b)=> new Date(a[SHEET_COL.DATETIME]) - new Date(b[SHEET_COL.DATETIME]));
  const d2 = lookaheadDays>=2
    ? rows.filter(isFutureConfirmed).filter(r=>r[SHEET_COL.DATETIME].startsWith(mk(2)))
      .sort((a,b)=> new Date(a[SHEET_COL.DATETIME]) - new Date(b[SHEET_COL.DATETIME]))
    : [];

  return { sameDayLater, d1, d2 };
}

function buildUpgradeBody(procKey, lang, newISO, oldISO){
  const fmt = (iso)=> new Date(iso).toLocaleString(lang==='en'?'en-US':'es-MX',{
    weekday:'short', day:'numeric', month:'short', hour:'2-digit', minute:'2-digit', hour12:true
  }).replace(/\./g,'');
  const newL = fmt(newISO), oldL = fmt(oldISO);
  return (lang==='en'
    ? `⚡ *A slot opened up!*\n\nWe can move your *${PROCEDURES[procKey][lang]}* to *${newL}* (earlier than *${oldL}*).\n\nDo you want to take it?`
    : `⚡ *Se liberó un espacio*\n\nPodemos adelantar tu *${PROCEDURES[procKey][lang]}* a *${newL}* (antes de *${oldL}*).\n\n¿Te gustaría tomarlo?`
  );
}

async function sendWave(slotISO, candidates, limit, randomize=false){
  if (!candidates?.length) return;
  const ctrl = UPGRADE_OLAS.get(slotISO);
  if (!ctrl || ctrl.filled) return;

  const list = randomize ? shuffle([...candidates]) : candidates.slice();
  let sent = 0;

  for (const r of list){
    if (ctrl.filled) break;
    const to = normalizePhone(r[SHEET_COL.PHONE]);
    if (ctrl.sentTo.has(to)) continue;

    const lang = r[SHEET_COL.LANG] || 'es';
    const proc = r[SHEET_COL.PROCEDURE'];
    const body = buildUpgradeBody(proc, lang, slotISO, r[SHEET_COL.DATETIME]);
    const buttons = [
      { type:'reply', reply:{ id:`upgrade_accept__${slotISO}__${r[SHEET_COL.DATETIME]}`, title:(lang==='en'?'✅ Take it':'✅ Tomarlo') } },
      { type:'reply', reply:{ id:`upgrade_skip__${slotISO}__${r[SHEET_COL.DATETIME]}`,   title:(lang==='en'?'No, thanks':'No gracias') } }
    ];
    await sendMessage(buildButtonMessage({ to, body, buttons }));
    ctrl.sentTo.add(to);
    sent++; if (sent>=limit) break;
  }
}

export async function proposeUpgradeStaged(
  cancelISO,
  overrides = {} // { perWave, delayMinutes, randomizeWithinWave, lookaheadDays }
){
  if (!(await isSlotFree(cancelISO))) return;
  if (!UPGRADE_OLAS.has(cancelISO)) UPGRADE_OLAS.set(cancelISO, { filled:false, sentTo:new Set(), timers:[] });
  const ctrl = UPGRADE_OLAS.get(cancelISO);

  const { sameDayLater, d1, d2 } = await getBuckets(cancelISO, overrides.lookaheadDays ?? 1);
  if (!sameDayLater.length && !d1.length && !d2.length) return;

  const perWave = overrides.perWave ?? UPGRADE_DEFAULT_PER_WAVE;
  const delay   = (overrides.delayMinutes ?? UPGRADE_DEFAULT_DELAY_MIN) * 60 * 1000;
  const random  = overrides.randomizeWithinWave ?? false;

  await sendWave(cancelISO, sameDayLater, perWave, random);

  const t1 = setTimeout(async ()=>{
    if (ctrl.filled) return;
    if (!(await isSlotFree(cancelISO))) return;
    await sendWave(cancelISO, d1, perWave, random);
  }, delay);
  ctrl.timers.push(t1);

  if ((overrides.lookaheadDays ?? 1) >= 2 && d2.length){
    const t2 = setTimeout(async ()=>{
      if (ctrl.filled) return;
      if (!(await isSlotFree(cancelISO))) return;
      await sendWave(cancelISO, d2, perWave, random);
    }, delay*2);
    ctrl.timers.push(t2);
  }
}

export function markUpgradeFilled(slotISO){
  const ctrl = UPGRADE_OLAS.get(slotISO);
  if (!ctrl) return;
  ctrl.filled = true;
  for (const t of ctrl.timers) clearTimeout(t);
  UPGRADE_OLAS.delete(slotISO);
}

/* ───────── MENÚ PRINCIPAL ───────── */
export async function sendMainMenu(toRaw) {
  const to = normalizePhone(toRaw);
  const buttons = [
    { type:'reply', reply:{ id:'book',     title:'📅 Agendar'   } },
    { type:'reply', reply:{ id:'location', title:'📍 Ubicación' } },
    { type:'reply', reply:{ id:'advisor',  title:'🧑‍💼 Asesor'   } }
  ];

  await sendMessage(
    buildButtonMessage({
      to,
      header : { type:'image', image:{ link:'https://i.imgur.com/eaRIe8M.png' } },
      body   : [
        '*🦷 ¡Bienvenido a tu Clínica Dental!*',
        '',
        '¡Hola! Soy *tu asistente virtual* 🤖',
        'Estoy aquí para ayudarte a agendar tu cita y resolver cualquier duda 😄',
        '',
        '📅 _¿Te gustaría programar una consulta?_',
        '📍 _¿Quieres saber cómo llegar a la clínica?_',
        '🧑‍💼 _¿Prefieres que te contacte un asesor?_',
        '',
        'Selecciona una *opción* del *menú* 👇'
      ].join('\n'),
      footer : '❤️ Tu sonrisa es nuestra prioridad.',
      buttons
    })
  );
}

/* ───────── SELECCIÓN DE PROCEDIMIENTO ───────── */
export async function startProcedureFlow(toRaw, lang) {
  const to = normalizePhone(toRaw);

  await sendMessage({
    messaging_product: 'whatsapp',
    to,
    type : 'image',
    image: { link: 'https://i.imgur.com/Yg2fUnR.jpeg' }
  });

  const rows = Object.entries(PROCEDURES).map(([k, v]) => ({
    id   : `proc_${k}`,
    title: v[lang]
  }));
  rows.push({
    id: 'advisor',
    title: lang === 'en' ? '🧑‍💼 Talk to an advisor' : '🧑‍💼 Hablar con un asesor'
  });

  await sendMessage(
    buildListMessage({
      to,
      header   : '🦷 Agenda tu cita dental',
      body     : [
        '📋 ¿Qué servicio necesitas hoy?',
        'Selecciona una opción del menú:'
      ].join('\n'),
      footer   : 'Tu sonrisa es prioridad ❤',
      buttonTxt: lang === 'en' ? 'Select' : 'Elegir',
      rows
    })
  );
}

export async function sendDatePicker(toRaw, procKey, lang) {
  const to = normalizePhone(toRaw);
  const today = new Date();
  const buttons = [...Array(3).keys()].map(i => {
    const d = new Date(today);
    d.setDate(today.getDate() + 1 + i);
    return {
      type : 'reply',
      reply: {
        id   : `day_${procKey}_${d.toISOString().slice(0,10)}`,
        title: d.toLocaleDateString(
          lang==='en' ? 'en-US' : 'es-MX',
          { weekday:'short', day:'numeric', month:'short' }
        ).replace(/\./g, '')
      }
    };
  });

  await sendMessage(
    buildButtonMessage({
      to,
      body   : lang==='en' ? 'Choose a date:' : 'Elige la fecha:',
      buttons
    })
  );
}

export async function sendHourPicker(toRaw, procKey, dateISO, lang) {
  const to = normalizePhone(toRaw);
  const buttons = hours.map(h => ({
    type : 'reply',
    reply: { id:`hour_${procKey}_${dateISO}_${h}`, title:`${h}h` }
  }));

  await sendMessage(
    buildButtonMessage({
      to,
      body   : lang==='en' ? 'Choose a time:' : 'Elige la hora:',
      buttons
    })
  );
}

/* ───────── CREAR CITA ───────── */
export async function finalizeBooking(phoneRaw, name, procKey, isoStart, lang) {
  const phone = normalizePhone(phoneRaw);
  const now   = Date.now();
  const slotStart = new Date(isoStart).getTime();

  if (slotStart <= now) {
    await sendMessage({
      messaging_product:'whatsapp',
      to: phone,
      text:{ body: '⏱️ Esa hora ya pasó o no está disponible. Por favor elige otro horario.' }
    });
    return { ok:false, reason:'past' };
  }

  // Pre-validación
  const all = await getAllRows();
  const alreadyTaken = all.some(r =>
    r[SHEET_COL.DATETIME] === isoStart && r[SHEET_COL.STATUS] !== 'CANCELADA'
  );

  const events = await listCalendarEventsByDate(isoStart.slice(0,10));
  const slotEnd   = new Date(slotStart + 30*60*1000);
  const conflictsCalendar = events.some(ev => {
    const evStart = new Date(ev.start?.dateTime || `${ev.start?.date}T00:00:00${TZ_OFFSET}`);
    const evEnd   = new Date(ev.end?.dateTime   || `${ev.end?.date}T23:59:59${TZ_OFFSET}`);
    return slotStart < evEnd && slotEnd > evStart;
  });

  if (alreadyTaken || conflictsCalendar) {
    await sendMessage({
      messaging_product:'whatsapp',
      to: phone,
      text:{ body:'😕 Ese horario se ocupó hace un momento. Por favor elige otro.' }
    });
    return { ok:false, reason:'taken-pre' };
  }

  // Append provisional
  const ts = new Date().toISOString();
  const row = Array(14).fill('');

  row[SHEET_COL.TIMESTAMP]    = ts;
  row[SHEET_COL.NAME]         = name;
  row[SHEET_COL.PHONE]        = `${phone}`;
  row[SHEET_COL.DATETIME]     = isoStart;
  row[SHEET_COL.PROCEDURE]    = procKey;
  row[SHEET_COL.STATUS]       = 'CONFIRMADA';
  row[SHEET_COL.LANG]         = lang;
  row[SHEET_COL.PDF_KEY]      = 'POST'; // no usado, pero indicamos que habrá PDF de “después”
  row[SHEET_COL.PDF_SENT]     = '';
  const fu = new Date(isoStart); fu.setMonth(fu.getMonth() + 6);
  row[SHEET_COL.FOLLOW_DATE]  = fu.toISOString();
  row[SHEET_COL.FOLLOW_SENT]  = '';
  row[SHEET_COL.CONFIRM_SENT] = 'FALSE';
  row[SHEET_COL.REMINDER_ACK] = '';
  row[SHEET_COL.NUDGE2H_SENT] = '';

  await appendRow(row);

  // Evento Calendar
  const summary = `${PROCEDURES[procKey][lang]} – ${name} – ${phone}`;
  const durationMin = PROC_DURATION_MIN[procKey] || 30;
  const colorId = PROC_COLOR_ID?.[procKey];
  const apptKey = `${ts}__${phone}`;
  const location = `${CLINIC.name}, ${CLINIC.addr}`;
  const description = [
    `Paciente: ${name}`,
    `Tel: +${phone}`,
    `Procedimiento: ${PROCEDURES[procKey][lang]}`,
    `WhatsApp: https://wa.me/${phone}`
  ].join('\n');

  await createCalendarEvent(summary, isoStart, {
    durationMin, colorId, apptKey, location, description
  });

  // Anti-overselling
  const rows = await getAllRows();
  const dupIdx = rows
    .map((r, i) => ({ r, i }))
    .filter(({ r }) => r[SHEET_COL.DATETIME] === isoStart && r[SHEET_COL.STATUS] !== 'CANCELADA');

  if (dupIdx.length > 1) {
    dupIdx.sort((a, b) => String(a.r[SHEET_COL.TIMESTAMP]).localeCompare(String(b.r[SHEET_COL.TIMESTAMP])));
    const winner = dupIdx[0];
    const losers = dupIdx.slice(1);

    for (const { r, i } of losers) {
      r[SHEET_COL.STATUS] = 'CANCELADA';
      await updateRow(i + 1, r);
      const loserPhone = normalizePhone(r[SHEET_COL.PHONE]);
      const loserApptKey = `${r[SHEET_COL.TIMESTAMP]}__${loserPhone}`;
      try { await deleteByKey(loserApptKey); } catch {}
    }

    const mine = dupIdx.find(({ r }) =>
      r[SHEET_COL.TIMESTAMP] === ts && normalizePhone(r[SHEET_COL.PHONE]) === phone
    );

    if (!mine || winner.r[SHEET_COL.TIMESTAMP] !== ts) {
      const myKey = `${ts}__${phone}`;
      try { await deleteByKey(myKey); } catch {}
      await sendMessage({
        messaging_product:'whatsapp',
        to: phone,
        text:{ body:'😕 Ese horario acaba de ocuparse. Te muestro otros horarios disponibles si lo deseas.' }
      });
      return { ok:false, reason:'taken-post' };
    }
  }

  /* ───────── ENVÍO FINAL (orden requerido) ─────────
     1) PDF (documento real, sin caption extra)
     2) Ubicación
     3) Mensaje de confirmación (debe ir al final) */
  await sendMessage(buildDocument(phone, PRE_APPT_PDF_URL, 'Indicaciones.pdf'));
  await sendMessage(buildLocation(phone, CLINIC));
  await sleep(900);
  await sendMessage({
    messaging_product: 'whatsapp',
    to: phone,
    text: { body: '✅¡Tu cita ha sido confirmada! Nos vemos pronto.' }
  });

  return { ok:true };
}

/* ───────── ESTADOS EN SHEETS ───────── */
export async function markStatus(iso, status) {
  const rows = await getAllRows();
  for (let i = 0; i < rows.length; i++) {
    if (rows[i][SHEET_COL.DATETIME] === iso) {
      rows[i][SHEET_COL.STATUS] = status;
      await updateRow(i + 1, rows[i]);
      break;
    }
  }
}

/* ───────── UBICACIÓN + CTA ───────── */
export async function sendLocationPlusText(toRaw) {
  const to = normalizePhone(toRaw);
  await sendMessage(buildLocation(to, CLINIC));
  await sendMessage(
    buildButtonMessage({
      to,
      body: [
        '📍 *¡Aquí nos encontramos!*',
        'Te compartimos la ubicación de *nuestro consultorio* para que llegues sin problemas 😊',
        '',
        '🔼 Consulta el *mapa* arriba 👆'
      ].join('\n'),
      buttons: [
        { type:'reply', reply:{ id:'main_menu', title:'📄 Menú' } },
        { type:'reply', reply:{ id:'advisor',   title:'🧑‍💼 Asesor' } }
      ]
    })
  );
}

/* ───────── INFO DETALLADA ───────── */
export async function sendProcedureInfo(toRaw, procKey, lang) {
  const to = normalizePhone(toRaw);
  const det = PROC_DETAILS[procKey];
  if (!det) return;

  const locale = det[lang] || det.es;

  await sendMessage(
    buildButtonMessage({
      to,
      header : { type:'image', image:{ link: det.img } },
      body   : locale.body,
      footer : locale.footer,
      buttons: [
        { type:'reply', reply:{ id:`schedule_${procKey}`, title:'🗓️ Agendar' } },
        { type:'reply', reply:{ id:'advisor',             title:'🧑‍💼 Asesor' } },
        { type:'reply', reply:{ id:'main_menu',           title:'🏠 Menú'    } }
      ]
    })
  );
}

/* ───────── INTRO “EXCELENTE ELECCIÓN” ───────── */
export async function sendScheduleIntro(toRaw, procKey, lang) {
  const to = normalizePhone(toRaw);
  const procName = PROCEDURES[procKey][lang];

  await sendMessage(
    buildButtonMessage({
      to,
      header : { type:'image', image:{ link:'https://i.imgur.com/OugxFz3.png' } },
      body   : [
        '🦷 ¡*Excelente elección*!',
        `Tu cita es para: *${procName}*`,
        '',
        'A continuación puedes agendar tu cita con la *Dra. Elena Paola*.',
        'Da clic en el botón para continuar 👇'
      ].join('\n'),
      buttons: [
        { type:'reply', reply:{ id:`pickdate_${procKey}`, title:'🗓️ Agendar' } },
        { type:'reply', reply:{ id:'advisor',             title:'🧑‍💼 Asesor' } },
        { type:'reply', reply:{ id:'main_menu',           title:'🏠 Menú' } }
      ]
    })
  );
}

/* ───────── LISTA DE DÍAS ───────── */
export async function sendDayList(toRaw, procKey, lang) {
  const to = normalizePhone(toRaw);
  const today = new Date();
  const clamp = (s, n) => [...s].slice(0, n).join('');

  const rows = [...Array(7).keys()].map(i => {
    const d = new Date(today);
    d.setDate(today.getDate() + 1 + i);

    const locale = lang === 'en' ? 'en-US' : 'es-MX';
    const dateISO = d.toISOString().slice(0, 10);

    const corto = d.toLocaleDateString(locale, {
      weekday: 'short', day: 'numeric', month: 'short'
    }).replace(/\./g, '');

    const largo = d.toLocaleDateString(locale, {
      weekday: 'long', day: 'numeric', month: 'long'
    });

    return {
      id: `day_${procKey}_${dateISO}`,
      title: clamp(corto, 24),
      description: clamp(largo, 72),
    };
  });

  rows.push({
    id: 'advisor',
    title: lang === 'en' ? '🧑‍💼 Talk to an advisor' : '🧑‍💼 Hablar con un asesor',
    description: lang === 'en' ? 'Get help by chat' : 'Atención por chat'
  });

  await sendMessage(
    buildListMessage({
      to,
      header   : lang === 'en'
                  ? '📅 Select your appointment day'
                  : '📅 Selecciona el día de tu cita',
      body     : lang === 'en'
                  ? 'First, choose the day you prefer for your visit with Dr. Elena Paola.'
                  : 'Primero, elige el día que prefieres para tu consulta con la Dra. Elena Paola.',
      footer   : lang === 'en'
                  ? '✅ Only dates with availability are shown.'
                  : '✅ Solo mostramos días con disponibilidad.',
      buttonTxt: lang === 'en' ? 'Select' : 'Elegir',
      rows
    })
  );
}

/* ───────── MAÑANA/TARDE ───────── */
export async function sendPeriodList(toRaw, procKey, dateISO, lang) {
  const to = normalizePhone(toRaw);
  const rows = [
    { id: `period_morning_${procKey}_${dateISO}`, title: lang === 'en' ? '☀️ Morning' : '☀️ Mañana' },
    { id: `period_evening_${procKey}_${dateISO}`, title: lang === 'en' ? '🌇 Evening' : '🌇 Tarde'  },
    { id: 'advisor', title: lang === 'en' ? '🧑‍💼 Talk to an advisor' : '🧑‍💼 Hablar con un asesor' }
  ];

  await sendMessage(
    buildListMessage({
      to,
      header   : lang === 'en'
                  ? '🕑 Select an available slot'
                  : '🕑 Selecciona un turno disponible',
      body     : lang === 'en'
                  ? 'Choose the time block you prefer for your appointment with Dr. Elena Paola:'
                  : 'Elige el bloque de horario que prefieras para tu cita con la Dra. Elena Paola:',
      footer   : '',
      buttonTxt: lang === 'en' ? 'Select' : 'Elegir',
      rows
    })
  );
}

/* ───────── LISTA DE HORAS ───────── */
export async function sendTimeList(toRaw, procKey, dateISO, period, lang) {
  const to = normalizePhone(toRaw);
  const tz    = TZ_OFFSET;
  const first = new Date(`${dateISO}T${period === 'morning' ? '09:00:00' : '15:40:00'}${tz}`);
  const last  = new Date(`${dateISO}T${period === 'morning' ? '15:00:00' : '21:00:00'}${tz}`);

  const reservedSheet = (await getAllRows())
    .filter(r =>
      r[SHEET_COL.DATETIME]?.startsWith(dateISO) &&
      r[SHEET_COL.STATUS] !== 'CANCELADA')
    .map(r => r[SHEET_COL.DATETIME].slice(11,16));

  const events = await listCalendarEventsByDate(dateISO);

  const rows = [];
  for (let t = new Date(first); t <= last; t.setMinutes(t.getMinutes() + 40)) {
    const hh = t.toTimeString().slice(0, 5);
    if (reservedSheet.includes(hh)) continue;

    const slotStart = new Date(t);
    const slotEnd   = new Date(slotStart.getTime() + 30*60*1000);
    const conflictsCalendar = events.some(ev => {
      const evStart = new Date(ev.start?.dateTime || `${ev.start?.date}T00:00:00${tz}`);
      const evEnd   = new Date(ev.end?.dateTime   || `${ev.end?.date}T23:59:59${tz}`);
      return slotStart < evEnd && slotEnd > evStart;
    });
    if (conflictsCalendar) continue;

    const label = t.toLocaleTimeString(
      lang === 'en' ? 'en-US' : 'es-MX',
      { hour: '2-digit', minute: '2-digit', hour12: true }
    );

    rows.push({ id:`hour_${procKey}_${dateISO}_${hh}`, title: label });
    if (rows.length === 9) break;
  }

  rows.push({
    id: 'advisor',
    title: lang === 'en' ? '🧑‍💼 Talk to an advisor' : '🧑‍💼 Hablar con un asesor'
  });

  await sendMessage(
    buildListMessage({
      to,
      header   : lang === 'en'
                  ? '📅 What time do you prefer?'
                  : '📅 ¿A qué hora prefieres tu cita?',
      body     : lang === 'en'
                  ? 'Choose the time slot that best fits your day 😊'
                  : 'Elige el horario que mejor se ajuste a tu día 😊',
      footer   : '',
      buttonTxt: lang === 'en' ? 'Select' : 'Elegir',
      rows
    })
  );
}
