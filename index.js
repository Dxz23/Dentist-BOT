// index.js
import express from 'express';
import cron from 'node-cron';
import {
  ENV, TZ_OFFSET, PROCEDURES, AGENTS, SHEET_COL,
  PROC_DURATION_MIN, PROC_COLOR_ID
} from './config/config.js';
import {
  appendLead, getAllRows, updateRow, rescheduleByKey,
  listCalendarEventsByDate, deleteByKey
} from './services/google.js';

import {
  sendMainMenu,
  startProcedureFlow,
  finalizeBooking,
  markStatus,
  sendLocationPlusText,
  sendProcedureInfo,
  sendScheduleIntro,
  sendTimeList,
  sendDayList,
  sendPeriodList,
  proposeUpgradeStaged,
  markUpgradeFilled
} from './flows/booking.js';

import './cron/jobs.js';
import { sendMessage, buildButtonMessage, normalizePhone } from './services/wa.js';

/* ────────── antirebote (deduplicador) ────────── */
const processed = new Set();
const MAX_IDS   = 5000;

/* ────────── estados ────────── */
const pendingByUser   = new Map(); // wa_id → { proc, dateISO, hour }
const advisorState    = new Map(); // wa_id → { name?: string, startedAt }
const rescheduleState = new Map(); // wa_id → { oldISO, proc, lang, name }

/* ────────── INTENT: bienvenida y palabras clave ────────── */
const seenUsers = new Set();

/** Devuelve un intent simple a partir de texto libre */
function intentFromText(txt) {
  const t = (txt || '').toLowerCase().normalize('NFD').replace(/\p{Diacritic}/gu, '');

  if (/\b(hola|buenas|menu|men[uú])\b/.test(t)) return { type: 'MENU' };
  if (/\b(agendar|cita|agenda|programar|reservar)\b/.test(t)) return { type: 'BOOK' };
  if (/\b(ubicacion|direccion|como llegar|mapa)\b/.test(t)) return { type: 'LOCATION' };
  if (/\b(asesor|asesora|humano|ayuda|advisor)\b/.test(t)) return { type: 'ADVISOR' };

  // procedimientos
  const procMap = {
    limpieza: 'LIMPIEZA',
    extraccion: 'EXTRACCION',
    ortodoncia: 'ORTODONCIA',
    blanqueamiento: 'BLANQUEAMIENTO',
    revision: 'REVISION',
    resina: 'RESINA',
    endodoncia: 'ENDODONCIA',
  };
  for (const k of Object.keys(procMap)) {
    if (t.includes(k)) return { type: 'PROC', key: procMap[k] };
  }

  return { type: 'UNKNOWN' };
}

/* ✅ Estado de embudo para nudges y reanudación */
const funnelState = new Map();
/*
funnelState[from] = {
  step: 'choose_proc' | 'choose_day' | 'choose_period' | 'choose_time' | 'await_name' | 'await_preconfirm',
  proc, dateISO, period, hour, lang, name?,
  lastAt: ms,
  createdAt: ms,
  nag1Sent?: boolean,
  nag2Sent?: boolean
}
*/
const NUDGE_MINUTES  = 8;
const NUDGE2_MINUTES = 25;
const NUDGE_MAX_AGE_MIN = 90; // si pasa más de 90 min, se limpia el estado y no se nudgea

function setFunnel(from, patch) {
  const prev = funnelState.get(from) || {};
  const baseTimes = prev.createdAt ? {} : { createdAt: Date.now() };
  funnelState.set(from, { ...prev, ...baseTimes, ...patch, lastAt: Date.now() });
}
function clearFunnel(from) { funnelState.delete(from); }

/* ────────── INIT ────────── */
const app = express();
app.use(express.json());

/* ────────── VERIFY TOKEN ────────── */
app.get('/webhook', (req, res) => {
  const { 'hub.mode': mode, 'hub.verify_token': token, 'hub.challenge': ch } = req.query;
  if (mode === 'subscribe' && token === ENV.VERIFY_TOKEN) return res.status(200).send(ch);
  return res.sendStatus(403);
});

/* ───────── helper: avisar a asesores ───────── */
async function notifyAgentsByText({ name, phone, message }) {
  const normalized = normalizePhone(phone);
  const link = `https://wa.me/${normalized}`;
  const body = [
    '📥 *Nuevo lead (Asesor)*',
    `👤 ${name || 'Paciente'}`,
    `📱 ${normalized}`,
    '',
    '💬 Mensaje:',
    message,
    '',
    `↪️ Abrir chat: ${link}`
  ].join('\n');

  for (const a of AGENTS) {
    await sendMessage({ messaging_product: 'whatsapp', to: a, text: { body } });
  }
}

/* ✅ Copys de nudge */
function nudgeCopy(step, lang, ctx = {}) {
  const procLabel = ctx.proc ? (PROCEDURES[ctx.proc]?.[lang] || ctx.proc) : '';
  const base = {
    title: lang==='en' ? 'Do you want to continue?' : '¿Seguimos con tu cita?',
    body : '',
    cta  : lang==='en' ? '✅ Continue' : '✅ Continuar'
  };
  switch (step) {
    case 'choose_proc':
      base.body = [
        '📅 *Estamos listos para agendar*',
        'Solo falta elegir el *servicio dental* que necesitas.',
        '',
        'Toca *Continuar* para ver el menú de servicios.'
      ].join('\n'); break;
    case 'choose_day':
      base.body = [
        '🗓️ *Elige el día de tu cita*',
        `Procedimiento: ${procLabel}`,
        '',
        'Toca *Continuar* para ver los días disponibles.'
      ].join('\n'); break;
    case 'choose_period':
      base.body = [
        '🕑 *¿Mañana o tarde?*',
        `Procedimiento: ${procLabel}`,
        '',
        'Toca *Continuar* para elegir el turno.'
      ].join('\n'); break;
    case 'choose_time':
      base.body = [
        '⏰ *Elige la hora que prefieras*',
        `Procedimiento: ${procLabel}`,
        '',
        'Toca *Continuar* para ver los horarios disponibles.'
      ].join('\n'); break;
    case 'await_name':
      base.body = [
        '📝 *Nos falta tu nombre*',
        `Procedimiento: ${procLabel}`,
        '',
        'Toca *Continuar* para indicarte cómo escribir tu nombre completo.'
      ].join('\n'); break;
    case 'await_preconfirm':
      base.body = [
        '✅ *Último paso*',
        `Revisa y confirma tu cita de ${procLabel}.`,
        '',
        'Toca *Continuar* para confirmar o ajustar detalles.'
      ].join('\n'); break;
  }
  return base;
}

/* 🔒 Guardas anti-mensajes-aleatorios */
async function hasFutureAppointmentFor(phoneNormalized) {
  const rows = await getAllRows();
  const now  = Date.now();
  return rows.some(r =>
    normalizePhone(r[SHEET_COL.PHONE]) === phoneNormalized &&
    r[SHEET_COL.STATUS] !== 'CANCELADA' &&
    r[SHEET_COL.DATETIME] &&
    new Date(r[SHEET_COL.DATETIME]).getTime() > now
  );
}

/* ✅ Nudges de abandono (cada 5 min) — con guardas */
cron.schedule('*/5 * * * *', async () => {
  const now = Date.now();
  for (const [from, st] of Array.from(funnelState.entries())) {
    const lang = st.lang || 'es';
    const to   = normalizePhone(from);
    const msSinceLast = now - (st.lastAt || 0);
    const minSinceLast = msSinceLast / 60000;
    const ageMin = (now - (st.createdAt || now)) / 60000;

    // 0) Si el estado es muy viejo, limpiar y no enviar nada
    if (ageMin > NUDGE_MAX_AGE_MIN) {
      funnelState.delete(from);
      continue;
    }

    // 1) Si la persona ya tiene una cita futura: limpiar y NO nudgear
    if (await hasFutureAppointmentFor(to)) {
      funnelState.delete(from);
      continue;
    }

    // 2) Ventanas de nudge
    const needs1 = !st.nag1Sent && minSinceLast >= NUDGE_MINUTES && minSinceLast < NUDGE2_MINUTES;
    const needs2 = !st.nag2Sent && minSinceLast >= NUDGE2_MINUTES && minSinceLast < NUDGE_MAX_AGE_MIN;

    if (!needs1 && !needs2) continue;

    const copy = nudgeCopy(st.step, lang, st);
    const id = (() => {
      switch (st.step) {
        case 'choose_proc':   return `resume_choose_proc`;
        case 'choose_day':    return `resume_day_${st.proc}`;
        case 'choose_period': return `resume_period_${st.proc}_${st.dateISO}`;
        case 'choose_time':   return `resume_time_${st.proc}_${st.dateISO}_${st.period}`;
        case 'await_name':    return `resume_name_${st.proc}_${st.dateISO}_${st.hour}`;
        case 'await_preconfirm': return `resume_pre_${st.proc}_${st.dateISO}_${st.hour}_${encodeURIComponent((st.name||'').replace(/_/g,'-'))}`;
        default: return 'resume_choose_proc';
      }
    })();

    const buttons = [
      { type:'reply', reply:{ id, title: copy.cta } },
      { type:'reply', reply:{ id:'cancel_flow', title: (lang==='en'?'❌ Cancel':'❌ Cancelar') } }
    ];

    await sendMessage(buildButtonMessage({
      to,
      body: copy.body,
      buttons
    }));

    if (needs1) funnelState.set(from, { ...st, nag1Sent: true });
    if (needs2) funnelState.set(from, { ...st, nag2Sent: true });
  }
});

/* ────────── WEBHOOK ────────── */
const app = express();
app.use(express.json());

app.post('/webhook', async (req, res) => {
  const value = req.body.entry?.[0]?.changes?.[0]?.value;
  if (!value?.messages) return res.sendStatus(200);

  const msg = value.messages[0];
  if (!msg) return res.sendStatus(200);

  const key = msg.context?.id || msg.id;
  if (processed.has(key)) return res.sendStatus(200);
  processed.add(key);
  if (processed.size > MAX_IDS) processed.delete(processed.values().next().value);

  const from = msg.from;
  const to   = normalizePhone(from);
  const lang = 'es';

  // —— Auto-bienvenida si es su primer texto y no vio nada antes
  if (msg.type === 'text' && !seenUsers.has(from)) {
    seenUsers.add(from);
    clearFunnel(from); // por si hubieran restos
    await sendMainMenu(to);
    return res.sendStatus(200);
  }

  /* ───── ASESOR: manejo de 1 o 2 mensajes ───── */
  if (msg.text && advisorState.has(from)) {
    const state = advisorState.get(from) || {};
    const text  = msg.text.body.trim();
    const profileName = value.contacts?.[0]?.profile?.name || '';

    const lines = text.split('\n').map(s => s.trim()).filter(Boolean);
    const nameRx = /^[A-Za-zÁÉÍÓÚÜÑáéíóúüñ.'\- ]{3,60}$/u;

    // A) "Nombre\nDuda..."
    if (!state.name && lines.length >= 2 && nameRx.test(lines[0])) {
      const name = lines[0];
      const note = lines.slice(1).join('\n');

      await appendLead([ new Date().toISOString(), name, to, note, 'PENDIENTE' ]);
      await notifyAgentsByText({ name, phone: to, message: note });

      advisorState.delete(from);
      clearFunnel(from);
      await sendMessage(
        buildButtonMessage({
          to,
          body: '✅ ¡Gracias! Un asesor te contactará por este medio en breve.',
          buttons: [{ type:'reply', reply:{ id:'main_menu', title:'📄 Menú' } }]
        })
      );
      return res.sendStatus(200);
    }

    // B) nombre solo
    const looksLikeName = nameRx.test(text) && !/[?!.:,;\d@]/.test(text);
    if (!state.name && looksLikeName) {
      advisorState.set(from, { ...state, name: text, startedAt: Date.now() });
      return res.sendStatus(200);
    }

    // C) duda
    const name = state.name || profileName || 'Paciente';
    const note = text;

    await appendLead([ new Date().toISOString(), name, to, note, 'PENDIENTE' ]);
    await notifyAgentsByText({ name, phone: to, message: note });

    advisorState.delete(from);
    clearFunnel(from);
    await sendMessage(
      buildButtonMessage({
        to,
        body: '✅ ¡Gracias! Un asesor te contactará por este medio en breve.',
        buttons: [{ type:'reply', reply:{ id:'main_menu', title:'📄 Menú' } }]
      })
    );
    return res.sendStatus(200);
  }

  /* ───── INTENTS por TEXTO (sin depender del “Menu”) ───── */
  if (msg.text?.body) {
    const intent = intentFromText(msg.text.body);

    if (intent.type === 'MENU') {
      clearFunnel(from);
      await sendMainMenu(to);
      return res.sendStatus(200);
    }

    if (intent.type === 'BOOK') {
      setFunnel(from, { step:'choose_proc', lang });
      await startProcedureFlow(to, lang);
      return res.sendStatus(200);
    }

    if (intent.type === 'LOCATION') {
      clearFunnel(from);
      await sendLocationPlusText(to);
      return res.sendStatus(200);
    }

    if (intent.type === 'ADVISOR') {
      advisorState.set(from, { startedAt: Date.now() });
      clearFunnel(from);
      await sendMessage({
        messaging_product: 'whatsapp',
        to,
        text: { body: ['🧑‍💼 *Asesor en línea*','Puedes escribir *tu nombre y tu duda*,','Un asesor te responderá en breve 😊'].join('\n') }
      });
      return res.sendStatus(200);
    }

    if (intent.type === 'PROC') {
      setFunnel(from, { step:'choose_day', proc: intent.key, lang });
      await sendProcedureInfo(to, intent.key, lang);
      return res.sendStatus(200);
    }
  }

  /* ───── TEXTO: nombre tras elegir hora (flujo de cita) ───── */
  if (msg.text && pendingByUser.has(from)) {
    const name = msg.text.body.trim();
    const { proc, dateISO, hour } = pendingByUser.get(from);
    pendingByUser.delete(from);

    const isoStart = `${dateISO}T${hour}:00${TZ_OFFSET}`;
    const resumen = [
      `👤 *Nombre:* ${name}`,
      `🗓️ *Fecha:* ${new Date(isoStart).toLocaleDateString('es-MX')}`,
      `⏰ *Hora:*  ${hour} hrs`,
      `🦷 *Procedimiento:* ${PROCEDURES[proc].es}`
    ].join('\n');

    const buttons = [
      { type: 'reply', reply: { id: `confirm_${isoStart}_${proc}_${name.replace(/\s+/g,'_')}`, title: '✅ Confirmar' } },
      { type: 'reply', reply: { id: `cancel_${isoStart}`, title: '❌ Cancelar' } },
      { type: 'reply', reply: { id: `resched_start_${proc}`, title: '🔁 Reagendar' } }
    ];

    setFunnel(from, { step:'await_preconfirm', proc, dateISO, hour, name, lang });
    await sendMessage(buildButtonMessage({ to, body: resumen, buttons }));
    return res.sendStatus(200);
  }

  /* ───── RESPUESTA LISTA (list_reply) ───── */
  if (msg.interactive?.list_reply) {
    const id = msg.interactive.list_reply.id;

    if (id === 'location') {
      clearFunnel(from);
      await sendLocationPlusText(to); return res.sendStatus(200);
    }

    if (id === 'advisor') {
      advisorState.set(from, { startedAt: Date.now() });
      clearFunnel(from);
      await sendMessage({
        messaging_product: 'whatsapp',
        to,
        text: { body: ['🧑‍💼 *Asesor en línea*','Puedes escribir *tu nombre y tu duda*','Un asesor te responderá en breve 😊'].join('\n') }
      });
      return res.sendStatus(200);
    }

    if (id.startsWith('proc_')) {
      const proc = id.slice(5);
      setFunnel(from, { step:'choose_day', proc, lang });
      await sendProcedureInfo(to, proc, lang);
      return res.sendStatus(200);
    }

    if (id.startsWith('day_')) {
      const [, proc, dateISO] = id.split('_');
      setFunnel(from, { step:'choose_period', proc, dateISO, lang });
      await sendPeriodList(to, proc, dateISO, lang);
      return res.sendStatus(200);
    }

    if (id.startsWith('period_')) {
      const [, period, proc, dateISO] = id.split('_');
      setFunnel(from, { step:'choose_time', proc, dateISO, period, lang });
      await sendTimeList(to, proc, dateISO, period, lang);
      return res.sendStatus(200);
    }

    if (id.startsWith('hour_')) {
      const [, proc, dateISO, hr] = id.split('_');

      // Reagendar existente
      if (rescheduleState.has(from)) {
        const state   = rescheduleState.get(from);
        const newISO  = `${dateISO}T${hr}:00${TZ_OFFSET}`;

        const rows    = await getAllRows();
        const conflictSheet = rows.some(r =>
          r[SHEET_COL.DATETIME] === newISO &&
          r[SHEET_COL.STATUS] !== 'CANCELADA' &&
          r[SHEET_COL.DATETIME] !== state.oldISO
        );

        const events = await listCalendarEventsByDate(dateISO);
        const tz = TZ_OFFSET;
        const slotStart = new Date(newISO);
        const slotEnd   = new Date(slotStart.getTime() + 30*60*1000);
        const conflictCal = events.some(ev => {
          const evStart = new Date(ev.start?.dateTime || `${ev.start?.date}T00:00:00${tz}`);
          const evEnd   = new Date(ev.end?.dateTime   || `${ev.end?.date}T23:59:59${tz}`);
          return slotStart < evEnd && slotEnd > evStart;
        });

        if (conflictSheet || conflictCal) {
          await sendMessage({
            messaging_product:'whatsapp',
            to,
            text:{ body:'😕 Ese horario se ocupó hace un momento. Por favor elige otro.' }
          });
          return res.sendStatus(200);
        }

        const idx     = rows.findIndex(r => r[SHEET_COL.DATETIME] === state.oldISO);
        if (idx === -1) {
          rescheduleState.delete(from);
          clearFunnel(from);
          await sendMessage({ messaging_product:'whatsapp', to, text:{ body:'⚠️ No pude encontrar tu cita anterior. Intenta de nuevo con *menú*.' }});
          return res.sendStatus(200);
        }
        const r = rows[idx];
        r[SHEET_COL.DATETIME] = newISO;
        const fu = new Date(newISO); fu.setMonth(fu.getMonth() + 6);
        r[SHEET_COL.FOLLOW_DATE] = fu.toISOString();
        await updateRow(idx + 1, r);

        const nameRow   = state.name || r[SHEET_COL.NAME] || 'Paciente';
        const summary   = `${PROCEDURES[state.proc][state.lang]} – ${nameRow} – ${to}`;
        const durationMin = PROC_DURATION_MIN[state.proc] || 30;
        const colorId   = PROC_COLOR_ID?.[state.proc];

        const apptKey = `${r[SHEET_COL.TIMESTAMP]}__${to}`;
        await rescheduleByKey(apptKey, newISO, { summary, durationMin, colorId });

        rescheduleState.delete(from);
        clearFunnel(from);

        const body = [
          '🔁 *Cita reagendada*',
          `🗓️ Nueva fecha: ${new Date(newISO).toLocaleString(state.lang==='en'?'en-US':'es-MX')}`,
          `🦷 ${PROCEDURES[state.proc][state.lang]}`
        ].join('\n');

        await sendMessage(
          buildButtonMessage({
            to,
            body,
            buttons: [
              { type:'reply', reply:{ id:'main_menu', title:'📄 Menú' } },
              { type:'reply', reply:{ id:`cancel_${newISO}`, title:'❌ Cancelar' } }
            ]
          })
        );
        return res.sendStatus(200);
      }

      // Flujo normal
      pendingByUser.set(from, { proc, dateISO, hour: hr });
      setFunnel(from, { step:'await_name', proc, dateISO, hour: hr, lang });
      await sendMessage({ messaging_product:'whatsapp', to, text:{ body:'📝 Por favor escribe tu *nombre completo* para la cita:' } });
      return res.sendStatus(200);
    }

    return res.sendStatus(200);
  }

  /* ───── RESPUESTA BOTÓN (button_reply) ───── */
  if (msg.interactive?.button_reply) {
    const id = msg.interactive.button_reply.id;

    if (id === 'main_menu') {
      clearFunnel(from);
      await sendMainMenu(to, lang); return res.sendStatus(200);
    }

    if (id === 'book') {
      setFunnel(from, { step:'choose_proc', lang });
      await startProcedureFlow(to, lang); return res.sendStatus(200);
    }

    if (id === 'location') {
      clearFunnel(from);
      await sendLocationPlusText(to); return res.sendStatus(200);
    }

    if (id === 'advisor') {
      advisorState.set(from, { startedAt: Date.now() });
      clearFunnel(from);
      await sendMessage({
        messaging_product: 'whatsapp',
        to,
        text: { body: ['🧑‍💼 *Asesor en línea*','Puedes escribir *tu nombre y tu duda*,','Un asesor te responderá en breve 😊'].join('\n') }
      });
      return res.sendStatus(200);
    }

    if (id === 'cancel_flow') {
      pendingByUser.delete(from);
      rescheduleState.delete(from);
      clearFunnel(from);
      await sendMessage({ messaging_product:'whatsapp', to, text:{ body:'✅ He cancelado el proceso. Si deseas, escribe *menú* para empezar de nuevo.' } });
      return res.sendStatus(200);
    }

    // Reabrir proceso (nudges)
    if (id.startsWith('resume_')) {
      const parts = id.split('_');
      const kind = parts[1];
      switch (kind) {
        case 'choose':
          setFunnel(from, { step:'choose_proc', lang });
          await startProcedureFlow(to, lang);
          break;
        case 'day': {
          const proc = parts[2];
          setFunnel(from, { step:'choose_day', proc, lang });
          await sendDayList(to, proc, lang);
          break;
        }
        case 'period': {
          const proc = parts[2]; const dateISO = parts[3];
          setFunnel(from, { step:'choose_period', proc, dateISO, lang });
          await sendPeriodList(to, proc, dateISO, lang);
          break;
        }
        case 'time': {
          const proc = parts[2]; const dateISO = parts[3]; const period = parts[4];
          setFunnel(from, { step:'choose_time', proc, dateISO, period, lang });
          await sendTimeList(to, proc, dateISO, period, lang);
          break;
        }
        case 'name': {
          const proc = parts[2]; const dateISO = parts[3]; const hour = parts[4];
          pendingByUser.set(from, { proc, dateISO, hour });
          setFunnel(from, { step:'await_name', proc, dateISO, hour, lang });
          await sendMessage({ messaging_product:'whatsapp', to, text:{ body:'📝 Por favor escribe tu *nombre completo* para la cita:' } });
          break;
        }
        case 'pre': {
          const proc = parts[2]; const dateISO = parts[3]; const hour = parts[4];
          const name = decodeURIComponent((parts.slice(5).join('_') || '').replace(/-/g,'_')).replace(/_/g,' ');
          const isoStart = `${dateISO}T${hour}:00${TZ_OFFSET}`;
          const resumen = [
            `👤 *Nombre:* ${name}`,
            `🗓️ *Fecha:* ${new Date(isoStart).toLocaleDateString('es-MX')}`,
            `⏰ *Hora:*  ${hour} hrs`,
            `🦷 *Procedimiento:* ${PROCEDURES[proc].es}`
          ].join('\n');
          const buttons = [
            { type: 'reply', reply: { id: `confirm_${isoStart}_${proc}_${name.replace(/\s+/g,'_')}`, title: '✅ Confirmar' } },
            { type: 'reply', reply: { id: `cancel_${isoStart}`, title: '❌ Cancelar' } },
            { type: 'reply', reply: { id: `resched_start_${proc}`, title: '🔁 Reagendar' } }
          ];
          setFunnel(from, { step:'await_preconfirm', proc, dateISO, hour, name, lang });
          await sendMessage(buildButtonMessage({ to, body: resumen, buttons }));
          break;
        }
      }
      return res.sendStatus(200);
    }

    if (id.startsWith('proc_')) {
      const proc = id.slice(5);
      setFunnel(from, { step:'choose_day', proc, lang });
      await sendProcedureInfo(to, proc, lang); return res.sendStatus(200);
    }

    if (id.startsWith('schedule_')) {
      const proc = id.slice(9);
      setFunnel(from, { step:'choose_day', proc, lang });
      await sendScheduleIntro(to, proc, lang); return res.sendStatus(200);
    }

    if (id.startsWith('pickdate_')) {
      const proc = id.slice(9);
      setFunnel(from, { step:'choose_day', proc, lang });
      await sendDayList(to, proc, lang); return res.sendStatus(200);
    }

    // Reagendar antes de confirmar
    if (id.startsWith('resched_start_')) {
      const proc = id.slice('resched_start_'.length);
      setFunnel(from, { step:'choose_day', proc, lang });
      await sendDayList(to, proc, lang);
      return res.sendStatus(200);
    }

    // Reagendar una cita ya creada
    if (id.startsWith('resched_')) {
      const oldISO = id.slice('resched_'.length);
      const rows   = await getAllRows();
      const r = rows.find(rr => rr[SHEET_COL.DATETIME] === oldISO);
      if (!r) {
        clearFunnel(from);
        await sendMessage({ messaging_product:'whatsapp', to, text:{ body:'⚠️ No encontré tu cita para reagendar.' } });
        return res.sendStatus(200);
      }
      const proc = r[SHEET_COL.PROCEDURE];
      const langRow = r[SHEET_COL.LANG] || 'es';
      rescheduleState.set(from, { oldISO, proc, lang: langRow, name: r[SHEET_COL.NAME] || 'Paciente' });
      setFunnel(from, { step:'choose_day', proc, lang: langRow });
      await sendDayList(to, proc, langRow);
      return res.sendStatus(200);
    }

    // Aceptar adelantar (upgrade)
    if (id.startsWith('upgrade_accept__')) {
      const payload = id.slice('upgrade_accept__'.length);
      const [newISO, oldISO] = payload.split('__');
      const rows = await getAllRows();
      const idx  = rows.findIndex(r => r[SHEET_COL.DATETIME] === oldISO && normalizePhone(r[SHEET_COL.PHONE]) === to);
      if (idx === -1) {
        clearFunnel(from);
        await sendMessage({ messaging_product:'whatsapp', to, text:{ body:'⚠️ No pude encontrar tu cita para moverla.' } });
        return res.sendStatus(200);
      }

      const takenSheet = rows.some(r => r[SHEET_COL.DATETIME] === newISO && r[SHEET_COL.STATUS] !== 'CANCELADA');
      const events = await listCalendarEventsByDate(newISO.slice(0,10));
      const slotStart = new Date(newISO);
      const slotEnd = new Date(slotStart.getTime() + 30*60*1000);
      const conflictCal = events.some(ev => {
        const evStart = new Date(ev.start?.dateTime || `${ev.start?.date}T00:00:00${TZ_OFFSET}`);
        const evEnd   = new Date(ev.end?.dateTime   || `${ev.end?.date}T23:59:59${TZ_OFFSET}`);
        return slotStart < evEnd && slotEnd > evStart;
      });

      if (takenSheet || conflictCal) {
        clearFunnel(from);
        await sendMessage({ messaging_product:'whatsapp', to, text:{ body:'😕 Ese espacio ya fue tomado por otra persona. Mantengo tu hora original.' } });
        return res.sendStatus(200);
      }

      const r = rows[idx];
      const langRow = r[SHEET_COL.LANG] || 'es';
      const procKey = r[SHEET_COL.PROCEDURE];
      const nameRow = r[SHEET_COL.NAME] || 'Paciente';
      const summary = `${PROCEDURES[procKey][langRow]} – ${nameRow} – ${to}`;
      const durationMin = PROC_DURATION_MIN[procKey] || 30;
      const colorId = PROC_COLOR_ID?.[procKey];

      r[SHEET_COL.DATETIME] = newISO;
      const fu = new Date(newISO); fu.setMonth(fu.getMonth() + 6);
      r[SHEET_COL.FOLLOW_DATE] = fu.toISOString();
      await updateRow(idx + 1, r);

      const apptKey = `${r[SHEET_COL.TIMESTAMP]}__${to}`;
      await rescheduleByKey(apptKey, newISO, { summary, durationMin, colorId });

      const label = new Date(newISO).toLocaleString(langRow==='en'?'en-US':'es-MX', {
        weekday:'long', day:'numeric', month:'long', hour:'2-digit', minute:'2-digit', hour12:true
      }).replace(/\./g,'');

      await sendMessage(buildButtonMessage({
        to,
        body: (langRow==='en'
          ? `✅ Your appointment was moved to *${label}*.\nIf you need to change it again, let me know.`
          : `✅ Tu cita fue adelantada a *${label}*.\nSi necesitas moverla de nuevo, avísame.`),
        buttons: [
          { type:'reply', reply:{ id:`resched_${newISO}`, title:(langRow==='en'?'🔁 Reschedule':'🔁 Reagendar') } },
          { type:'reply', reply:{ id:`cancel_${newISO}`,  title:(langRow==='en'?'❌ Cancel':'❌ Cancelar') } },
          { type:'reply', reply:{ id:'main_menu',         title:'🏠 Menú' } }
        ]
      }));

      markUpgradeFilled(newISO);
      clearFunnel(from);
      await proposeUpgradeStaged(oldISO, { perWave: 3, delayMinutes: 8, lookaheadDays: 2 });

      return res.sendStatus(200);
    }

    if (id.startsWith('upgrade_skip__')) {
      clearFunnel(from);
      await sendMessage({ messaging_product:'whatsapp', to, text:{ body:'👌 ¡Gracias! Mantengo tu cita como estaba.' } });
      return res.sendStatus(200);
    }

    // Confirmar / Cancelar
    if (id.startsWith('confirm_')) {
      const parts = id.split('_');

      // A) Confirmación de nueva cita
      if (parts.length >= 4) {
        const [, iso, proc, nameSlug] = parts;
        const result = await finalizeBooking(to, nameSlug.replace(/_/g, ' '), proc, iso, lang);
        if (result?.ok) await markStatus(iso, 'CONFIRMADA');
        clearFunnel(from);
        return res.sendStatus(200);
      }

      // B) Confirmación desde recordatorio 3h
      const iso = parts[1];
      const rows = await getAllRows();
      const idx  = rows.findIndex(r => r[SHEET_COL.DATETIME] === iso && normalizePhone(r[SHEET_COL.PHONE]) === to);
      if (idx !== -1) {
        rows[idx][SHEET_COL.REMINDER_ACK] = 'TRUE';
        await updateRow(idx + 1, rows[idx]);
      }
      clearFunnel(from);
      await sendMessage({ messaging_product:'whatsapp', to, text:{ body:'✅ ¡Tu asistencia quedó confirmada! Nos vemos pronto.' } });
      return res.sendStatus(200);
    }

    if (id.startsWith('confirm2h_')) {
      const iso = id.slice('confirm2h_'.length);
      const rows = await getAllRows();
      const idx  = rows.findIndex(r => r[SHEET_COL.DATETIME] === iso && normalizePhone(r[SHEET_COL.PHONE]) === to);
      if (idx !== -1) {
        rows[idx][SHEET_COL.REMINDER_ACK] = 'TRUE';
        await updateRow(idx + 1, rows[idx]);
      }
      clearFunnel(from);
      await sendMessage({ messaging_product:'whatsapp', to, text:{ body:'✅ ¡Gracias! Te esperamos a tu cita.' } });
      return res.sendStatus(200);
    }

    if (id.startsWith('cancel_')) {
      const iso = id.slice(7);
      await markStatus(iso, 'CANCELADA');

      const rows = await getAllRows();
      const row = rows.find(r => r[SHEET_COL.DATETIME] === iso && normalizePhone(r[SHEET_COL.PHONE]) === to);
      if (row) {
        const apptKeyCancel = `${row[SHEET_COL.TIMESTAMP]}__${to}`;
        try { await deleteByKey(apptKeyCancel); } catch {}
      }

      pendingByUser.delete(from);
      rescheduleState.delete(from);
      clearFunnel(from);
      await sendMessage({ messaging_product:'whatsapp', to, text:{ body:'❌ Cita cancelada. Si necesitas otra hora, escribe *menú*.' } });

      await proposeUpgradeStaged(iso, { perWave: 3, delayMinutes: 8, lookaheadDays: 2 });

      return res.sendStatus(200);
    }

    return res.sendStatus(200);
  }

  // Fallback: Si nada coincidió y es texto u otra interacción, manda menú y limpia cualquier estado viejo
  if (msg.type === 'text' || msg.type === 'interactive') {
    clearFunnel(from);
    await sendMainMenu(to);
  }

  return res.sendStatus(200);
});

/* ────────── START SERVER ────────── */
app.listen(3000, () => console.log('Dentist-Bot ready on :3000'));
