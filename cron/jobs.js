// cron/jobs.js
import cron from 'node-cron';
import { SHEET_COL, PDF_MAP, PROCEDURES } from '../config/config.js';
import { getAllRows, updateRow } from '../services/google.js';
import { sendMessage, buildDocument, buildButtonMessage, normalizePhone } from '../services/wa.js';

/* ───────────────────── 1) PDF post-consulta (cada 5 min) ───────────────────── */
cron.schedule('*/5 * * * *', async () => {
  const rows = await getAllRows();
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    if (r[SHEET_COL.STATUS] === 'COMPLETADA' && r[SHEET_COL.PDF_SENT] !== 'TRUE') {
      const link = PDF_MAP[r[SHEET_COL.PDF_KEY]];
      if (!link) continue;

      await sendMessage(
        buildDocument(normalizePhone(r[SHEET_COL.PHONE]), link)
      );

      r[SHEET_COL.PDF_SENT] = 'TRUE';
      await updateRow(i + 1, r);
    }
  }
});

/* ───────────────────── 2) Follow-up a 6 meses (09:00 diario) ────────────────── */
cron.schedule('0 9 * * *', async () => {
  const rows  = await getAllRows();
  const today = new Date().toISOString().slice(0, 10);

  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    if (r[SHEET_COL.FOLLOW_SENT] === 'TRUE') continue;

    if (r[SHEET_COL.FOLLOW_DATE]?.slice(0, 10) === today) {
      const lang = r[SHEET_COL.LANG] || 'es';

      await sendMessage({
        messaging_product: 'whatsapp',
        to: normalizePhone(r[SHEET_COL.PHONE]),
        template: {
          name: 'followup_6m',
          language: { code: lang === 'en' ? 'en_US' : 'es_MX' },
          components: []
        }
      });

      r[SHEET_COL.FOLLOW_SENT] = 'TRUE';
      await updateRow(i + 1, r);
    }
  }
});

/* ──────────────── 3) Recordatorio 3 h antes (cada 5 min, con fallback) ──────────────── */
cron.schedule('*/5 * * * *', async () => {
  const rows = await getAllRows();
  const now  = Date.now();

  const threeH    = 3 * 60 * 60 * 1000;  // 3 horas (ms)
  const tolerance = 5 * 60 * 1000;       // ±5 min

  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];

    if (r[SHEET_COL.CONFIRM_SENT] === 'TRUE') continue;
    if (r[SHEET_COL.STATUS] !== 'CONFIRMADA') continue;

    const startMs = new Date(r[SHEET_COL.DATETIME]).getTime();
    const delta   = startMs - now;
    if (Math.abs(delta - threeH) > tolerance) continue;

    const lang      = (r[SHEET_COL.LANG] || 'es');
    const to        = normalizePhone(r[SHEET_COL.PHONE]);
    const name      = r[SHEET_COL.NAME] || (lang === 'en' ? 'Patient' : 'Paciente');
    const procKey   = r[SHEET_COL.PROCEDURE];
    const procLabel = (PROCEDURES[procKey] && PROCEDURES[procKey][lang]) || procKey;

    const dateLabel = new Date(startMs).toLocaleString(
      lang === 'en' ? 'en-US' : 'es-MX',
      { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hour12: true }
    ).replace(/\./g, '');

    try {
      const body = [
        `¡Hola ${name}! 😁`,
        '',
        `Tenemos tu *${procLabel}* agendada para *${dateLabel}* en *Consultorio Dental Dr. López*.`,
        '',
        `*¿Confirmas tu asistencia?* _Si necesitas moverla, puedes reagendar._ 🙌`
      ].join('\n');

      const buttons = [
        { type: 'reply', reply: { id: `confirm_${r[SHEET_COL.DATETIME]}`, title: (lang === 'en' ? '✅ Confirm'    : '✅ Confirmar') } },
        { type: 'reply', reply: { id: `resched_${r[SHEET_COL.DATETIME]}`, title: (lang === 'en' ? '🔁 Reschedule' : '🔁 Reagendar') } },
        { type: 'reply', reply: { id: `cancel_${r[SHEET_COL.DATETIME]}`,  title: (lang === 'en' ? '❌ Cancel'     : '❌ Cancelar')  } }
      ];

      await sendMessage(
        buildButtonMessage({
          to,
          header: { type: 'image', image: { link: 'https://i.imgur.com/OgcNJXf.png' } },
          body,
          footer: (lang === 'en' ? 'Your smile is our priority.' : 'Tu sonrisa es nuestra prioridad.'),
          buttons
        })
      );

      r[SHEET_COL.CONFIRM_SENT] = 'TRUE';
      await updateRow(i + 1, r);
      continue;

    } catch (err) {
      console.log('⚠️ Interactivo falló; usando plantilla. Detalle:', err?.response?.data || err?.message);
    }

    try {
      await sendMessage({
        messaging_product: 'whatsapp',
        to,
        template: {
          name: 'appointment_scheduling',
          language: { code: (lang === 'en' ? 'en_US' : 'es_MX') },
          components: [{
            type: 'body',
            parameters: [
              { type: 'text', text: name },
              { type: 'text', text: dateLabel },
              { type: 'text', text: procLabel }
            ]
          }]
        }
      });

      r[SHEET_COL.CONFIRM_SENT] = 'TRUE';
      await updateRow(i + 1, r);

    } catch (errTpl) {
      console.log('❌ Error al enviar plantilla:', errTpl?.response?.data || errTpl?.message);
    }
  }
});

/* ───────────── 4) Auto-completar y enviar PDF (cada 10 min) ───────────── */
cron.schedule('*/10 * * * *', async () => {
  const rows = await getAllRows();
  const now  = Date.now();

  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const startISO = r[SHEET_COL.DATETIME];
    if (!startISO) continue;

    const start = new Date(startISO).getTime();

    if (r[SHEET_COL.STATUS] === 'CONFIRMADA' && now - start > 60 * 60 * 1000) {
      r[SHEET_COL.STATUS] = 'COMPLETADA';
      await updateRow(i + 1, r);
    }

    if (r[SHEET_COL.STATUS] === 'COMPLETADA' && r[SHEET_COL.PDF_SENT] !== 'TRUE') {
      const link = PDF_MAP[r[SHEET_COL.PDF_KEY]];
      if (!link) continue;

      await sendMessage(buildDocument(normalizePhone(r[SHEET_COL.PHONE]), link));
      r[SHEET_COL.PDF_SENT] = 'TRUE';
      await updateRow(i + 1, r);
    }
  }
});

/* ───────────── 5) Nudge a 2 horas si no respondió al de 3h (cada 5 min) ───────────── */
cron.schedule('*/5 * * * *', async () => {
  const rows = await getAllRows();
  const now  = Date.now();
  const twoH = 2 * 60 * 60 * 1000;
  const tolerance = 5 * 60 * 1000;

  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    if (r[SHEET_COL.STATUS] !== 'CONFIRMADA') continue;
    if (r[SHEET_COL.CONFIRM_SENT] !== 'TRUE') continue;      // se envió 3h
    if (r[SHEET_COL.REMINDER_ACK] === 'TRUE') continue;      // ya confirmó
    if (r[SHEET_COL.NUDGE2H_SENT] === 'TRUE') continue;      // ya nudged 2h

    const startMs = new Date(r[SHEET_COL.DATETIME]).getTime();
    if (Math.abs(startMs - now - twoH) > tolerance) continue;

    const lang      = (r[SHEET_COL.LANG] || 'es');
    const to        = normalizePhone(r[SHEET_COL.PHONE]);
    const name      = r[SHEET_COL.NAME] || (lang === 'en' ? 'Patient' : 'Paciente');
    const procKey   = r[SHEET_COL.PROCEDURE];
    const procLabel = (PROCEDURES[procKey] && PROCEDURES[procKey][lang]) || procKey;

    const dateLabel = new Date(startMs).toLocaleString(
      lang === 'en' ? 'en-US' : 'es-MX',
      { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hour12: true }
    ).replace(/\./g, '');

    const body = [
      '⏰ *¡Faltan 2 horas para tu cita!*',
      '',
      `👤 ${name}`,
      `🦷 ${procLabel}`,
      `🗓️ ${dateLabel}`,
      '',
      'Por favor confirma para mantener tu espacio reservado:',
    ].join('\n');

    const buttons = [
      { type:'reply', reply:{ id:`confirm2h_${r[SHEET_COL.DATETIME]}`, title:(lang==='en'?'✅ Continue':'✅ Continuar') } },
      { type:'reply', reply:{ id:`cancel_${r[SHEET_COL.DATETIME]}`,   title:(lang==='en'?'❌ Cancel':'❌ Cancelar') } }
    ];

    await sendMessage(buildButtonMessage({ to, body, buttons }));
    r[SHEET_COL.NUDGE2H_SENT] = 'TRUE';
    await updateRow(i + 1, r);
  }
});
