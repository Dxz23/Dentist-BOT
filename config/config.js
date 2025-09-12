import dotenv from 'dotenv';
dotenv.config();

export const ENV = {
  WA_TOKEN:     process.env.WA_TOKEN,
  PHONE_ID:     process.env.PHONE_ID,
  VERIFY_TOKEN: process.env.VERIFY_TOKEN,
  SHEET_ID:     process.env.SHEET_ID,
  CALENDAR_ID:  process.env.CALENDAR_ID,
};

export const CLINIC = {
  lat:  32.525,
  lng: -117.019,
  name: 'Consultorio Dental Dr. López',
  addr: 'Av. Revolución 123, Tijuana',
};

// Procedimientos disponibles
export const PROCEDURES = {
  LIMPIEZA:       { es: '🧼 Limpieza dental',      en: '🧼 Cleaning' },
  EXTRACCION:     { es: '🦷 Extracción',           en: '🦷 Extraction' },
  ORTODONCIA:     { es: '😬 Ortodoncia',           en: '😬 Braces' },
  BLANQUEAMIENTO: { es: '💎 Blanqueamiento',       en: '💎 Whitening' },
  REVISION:       { es: '📋 Revisión general',     en: '📋 General check-up' },
  // añadidos para coincidir con PDF_MAP
  RESINA:         { es: '🧩 Resina',               en: '🧩 Composite filling' },
  ENDODONCIA:     { es: '🧠 Endodoncia',           en: '🧠 Root canal' },
};

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
    en : { /* …opcional…*/ }
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
    en : { /* opcional */ }
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
    en : { /* opcional */ }
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
    en : { /* opcional */ }
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
    en : { /* opcional */ }
  },
  // Puedes añadir detalles para RESINA/ENDODONCIA cuando lo desees
};

export const PDF_MAP = {
  LIMPIEZA:       'https://tudominio.com/pdfs/pre_limpieza.pdf',
  EXTRACCION:     'https://tudominio.com/pdfs/pre_extraccion.pdf',
  ORTODONCIA:     'https://tudominio.com/pdfs/pre_ortodoncia.pdf',
  RESINA:         'https://tudominio.com/pdfs/pre_resina.pdf',
  BLANQUEAMIENTO: 'https://tudominio.com/pdfs/pre_blanqueamiento.pdf',
  ENDODONCIA:     'https://tudominio.com/pdfs/pre_endodoncia.pdf',
  REVISION:       'https://tudominio.com/pdfs/pre_revision.pdf',
};

export const SHEET_COL = {
  TIMESTAMP:    0,   // fecha_creacion
  NAME:         1,   // nombre
  PHONE:        2,   // telefono
  DATETIME:     3,   // fecha_hora_iso
  PROCEDURE:    4,   // procedimiento
  STATUS:       5,   // estado
  LANG:         6,   // idioma
  PDF_KEY:      7,   // pdf_clave
  PDF_SENT:     8,   // pdf_enviado
  FOLLOW_DATE:  9,   // seguimiento_fecha
  FOLLOW_SENT: 10,   // seguimiento_enviado
  CONFIRM_SENT: 11,  // recordatorio_3h_enviado
  REMINDER_ACK: 12,  // confirmó desde recordatorio 3h / 2h
  NUDGE2H_SENT: 13   // ya mandamos nudge de 2h
};

export const TZ_OFFSET = '-07:00'; // America/Tijuana (se maneja DST en Calendar)

export const AGENTS = [
  '5216634825319',
  '526634825319',
  '6634825319',
  '+6634825319',
  '+526634825319',
  '+5216634825319',
];

/* === NUEVO: Duración y color por procedimiento para Calendar === */
export const PROC_DURATION_MIN = {
  LIMPIEZA: 40,
  EXTRACCION: 30,
  ORTODONCIA: 30,
  BLANQUEAMIENTO: 60,
  REVISION: 30,
  RESINA: 40,
  ENDODONCIA: 60
};

// IDs de color de Google Calendar (1..11). Ajusta los que quieras.
export const PROC_COLOR_ID = {
  LIMPIEZA: '10',
  EXTRACCION: '11',
  ORTODONCIA: '2',
  BLANQUEAMIENTO: '5',
  REVISION: '7',
  RESINA: '6',
  ENDODONCIA: '4'
};

// Nota: Se eliminó la función duplicada sendScheduleIntro de este archivo.
// La versión oficial vive en flows/booking.js
