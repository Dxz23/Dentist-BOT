// config/config.js
import dotenv from 'dotenv';
dotenv.config();

export const ENV = {
  WA_TOKEN:     process.env.WA_TOKEN,
  PHONE_ID:     process.env.PHONE_ID,
  VERIFY_TOKEN: process.env.VERIFY_TOKEN,
  SHEET_ID:     process.env.SHEET_ID,
  CALENDAR_ID:  process.env.CALENDAR_ID,
};

// Clínica
export const CLINIC = {
  lat:  32.525,
  lng: -117.019,
  name: 'Consultorio Dental Dr. López',
  addr: 'Av. Revolución 123, Tijuana',
};

// Procedimientos disponibles (ES/EN)
export const PROCEDURES = {
  LIMPIEZA:       { es: '🧼 Limpieza dental',      en: '🧼 Cleaning' },
  EXTRACCION:     { es: '🦷 Extracción',           en: '🦷 Extraction' },
  ORTODONCIA:     { es: '😬 Ortodoncia',           en: '😬 Braces' },
  BLANQUEAMIENTO: { es: '💎 Blanqueamiento',       en: '💎 Whitening' },
  REVISION:       { es: '📋 Revisión general',     en: '📋 General check-up' },
  RESINA:         { es: '🧩 Resina',               en: '🧩 Composite filling' },
  ENDODONCIA:     { es: '🧠 Endodoncia',           en: '🧠 Root canal' },
};

// Detalles por procedimiento (texto + imagen)
export const PROC_DETAILS = {
  LIMPIEZA: {
    img: 'https://i.imgur.com/cNIV947.png',
    es : {
      body: [
        '🧼 *Eliminamos sarro, manchas y placa*',
        '',
        '✨ *Beneficios*:',
        '_😁 Mejora el aspecto de tus *dientes*_',
        '_😮‍💨 Previene *caries* y *mal aliento*_',
        '',
        '*⏱️ Duración:* 30–40 min',
        '*💵 Costo:* $400 MXN'
      ].join('\n'),
      footer: 'Confirma tu cita hoy mismo para asegurar disponibilidad.'
    },
    en : {}
  },
  EXTRACCION: {
    img: 'https://i.imgur.com/swN4HGt.png',
    es : {
      body: [
        '🦷 Retiro de piezas *dentales* *dañadas*',
        '',
        '✨ *Beneficios*:',
        '💊 _Alivia *dolor* por *infecciones* o *muelas dañadas*_',
        '😌 _Previene complicaciones mayores o *inflamación*_',
        '',
        '*⏱️ Duración*: 30 min aprox',
        '*💵 Desde*: $500 MXN'
      ].join('\n'),
      footer: 'Confirma tu cita hoy mismo para asegurar disponibilidad.'
    },
    en : {}
  },
  ORTODONCIA: {
    img: 'https://i.imgur.com/8w3ocua.png',
    es : {
      body: [
        '😬 *Ortodoncia*',
        '😬 Consulta para evaluación o seguimiento de *brackets*',
        '',
        '✨ *Beneficios*:',
        '📊 _Revisión con *ortodoncista certificado*_',
        '😁 _Mejora la *alineación* y *estética dental*_',
        '',
        '*⏱️ Duración*: 20–30 min',
        '*💵 Costo*: $350 MXN'
      ].join('\n'),
        footer: 'Confirma tu cita hoy mismo para asegurar disponibilidad.'
    },
    en : {}
  },
  BLANQUEAMIENTO: {
    img: 'https://i.imgur.com/WFB1Qsn.png',
    es : {
      body: [
        '✨ *Blanqueamiento dental*',
        '✨ Dientes más *blancos* desde la primera sesión',
        '',
        '✨ *Beneficios*:',
        '📈 _Mejora estética rápida y visible_',
        '📷 _Ideal para eventos, entrevistas o fotos_',
        '',
        '*⏱️ Duración*: 40–60 min',
        '*💵 Costo*: $1,000 MXN'
      ].join('\n'),
      footer: 'Confirma tu cita hoy mismo para asegurar disponibilidad.'
    },
    en : {}
  },
  REVISION: {
    img: 'https://i.imgur.com/jCCFA0v.png',
    es : {
      body: [
        '📋 *Revisión general*',
        '📋 Evaluamos tu *salud bucal* completa',
        '',
        '✨ *Beneficios*:',
        '🦷 _Detectamos *caries, encías inflamadas o desgastes*_',
        '📋 _Incluye *diagnóstico* y plan de tratamiento_',
        '',
        '*⏱️ Duración*: 20–30 min',
        '*💵 Costo*: $250 MXN'
      ].join('\n'),
      footer: 'Confirma tu cita hoy mismo para asegurar disponibilidad.'
    },
    en : {}
  },
  RESINA: {
    img: 'https://i.imgur.com/cNIV947.png',
    es : {
      body: [
        '🧩 *Resina* (relleno estético)',
        '',
        '✨ *Beneficios*:',
        '🦷 _Restaura forma y función_',
        '😁 _Mejora estética del diente_',
        '',
        '*⏱️ Duración*: 40 min',
        '*💵 Costo*: variable'
      ].join('\n'),
      footer: 'Confirma tu cita hoy mismo para asegurar disponibilidad.'
    },
    en : {}
  },
  ENDODONCIA: {
    img: 'https://i.imgur.com/swN4HGt.png',
    es : {
      body: [
        '🧠 *Endodoncia* (tratamiento de conducto)',
        '',
        '✨ *Beneficios*:',
        '💊 _Elimina infección y dolor_',
        '🦷 _Conserva la pieza dental_',
        '',
        '*⏱️ Duración*: 60 min',
        '*💵 Costo*: variable'
      ].join('\n'),
      footer: 'Confirma tu cita hoy mismo para asegurar disponibilidad.'
    },
    en : {}
  }
};

// (Compatibilidad; ya no se usa directamente)
export const PDF_MAP = {
  LIMPIEZA:       'https://tudominio.com/pdfs/pre_limpieza.pdf',
  EXTRACCION:     'https://tudominio.com/pdfs/pre_extraccion.pdf',
  ORTODONCIA:     'https://tudominio.com/pdfs/pre_ortodoncia.pdf',
  RESINA:         'https://tudominio.com/pdfs/pre_resina.pdf',
  BLANQUEAMIENTO: 'https://tudominio.com/pdfs/pre_blanqueamiento.pdf',
  ENDODONCIA:     'https://tudominio.com/pdfs/pre_endodoncia.pdf',
  REVISION:       'https://tudominio.com/pdfs/pre_revision.pdf',
};

// >>> Enlaces RAW de GitHub para antes/después:
export const PRE_APPT_PDF_URL  = 'https://raw.githubusercontent.com/Dxz23/Dentist-BOT/main/Antes_consulta.pdf';
export const POST_APPT_PDF_URL = 'https://raw.githubusercontent.com/Dxz23/Dentist-BOT/main/Despues_consulta.pdf';

// Columnas de la hoja
export const SHEET_COL = {
  TIMESTAMP:    0,
  NAME:         1,
  PHONE:        2,
  DATETIME:     3,
  PROCEDURE:    4,
  STATUS:       5,
  LANG:         6,
  PDF_KEY:      7,   // no lo usamos ya, pero mantenido
  PDF_SENT:     8,   // se marca TRUE cuando se envía el PDF de después
  FOLLOW_DATE:  9,
  FOLLOW_SENT: 10,
  CONFIRM_SENT: 11,
  REMINDER_ACK: 12,
  NUDGE2H_SENT: 13
};

export const TZ_OFFSET = '-07:00'; // America/Tijuana (DST manejado en Calendar)

// Agentes/asesores notificados
export const AGENTS = [
  '5216634825319',
  '526634825319',
  '6634825319',
  '+6634825319',
  '+526634825319',
  '+5216634825319',
];

/* Duración y color por procedimiento para Calendar */
export const PROC_DURATION_MIN = {
  LIMPIEZA: 40,
  EXTRACCION: 30,
  ORTODONCIA: 30,
  BLANQUEAMIENTO: 60,
  REVISION: 30,
  RESINA: 40,
  ENDODONCIA: 60
};

export const PROC_COLOR_ID = {
  LIMPIEZA: '10',
  EXTRACCION: '11',
  ORTODONCIA: '2',
  BLANQUEAMIENTO: '5',
  REVISION: '7',
  RESINA: '6',
  ENDODONCIA: '4'
};
