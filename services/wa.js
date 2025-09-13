// services/wa.js
import axios from 'axios';
import { ENV } from '../config/config.js';

export function normalizePhone(input) {
  const d = String(input || '').replace(/\D/g, '');
  if (d.startsWith('521')) return d;
  if (d.startsWith('52'))  return '521' + d.slice(2);
  if (d.length === 10)     return '521' + d;
  return d;
}

const instance = axios.create({
  baseURL: `https://graph.facebook.com/v22.0/${ENV.PHONE_ID}`,
  headers: { Authorization: `Bearer ${ENV.WA_TOKEN}` },
  timeout: 10000
});

async function withRetry(fn, tries = 3) {
  let last;
  for (let i = 0; i < tries; i++) {
    try { return await fn(); }
    catch (e) {
      last = e;
      await new Promise(r => setTimeout(r, 500 * (i + 1)));
    }
  }
  throw last;
}

export async function sendMessage(payload) {
  try {
    await withRetry(() => instance.post('/messages', payload));
  } catch (err) {
    console.log('❌ Error WA ➜', err?.response?.data || err?.message);
  }
}

export function buildButtonMessage({ to, header, body, footer, buttons }) {
  const interactive = {
    type  : 'button',
    body  : { text: body },
    action: { buttons }
  };

  if (header) {
    interactive.header =
      typeof header === 'string'
        ? { type: 'text', text: header }
        : header;
  }
  if (footer) interactive.footer = { text: footer };

  return {
    messaging_product: 'whatsapp',
    to,
    type: 'interactive',
    interactive
  };
}

export function buildListMessage({ to, header, body, footer, buttonTxt, rows }) {
  const interactive = {
    type : 'list',
    body : { text: body },
    action: {
      button  : buttonTxt,
      sections: [{ title: 'Opciones', rows }]
    }
  };

  if (header) interactive.header = { type: 'text', text: header };
  if (footer) interactive.footer = { text: footer };

  return {
    messaging_product: 'whatsapp',
    to,
    type: 'interactive',
    interactive
  };
}

export function buildLocation(to, loc) {
  return {
    messaging_product: 'whatsapp',
    to,
    type: 'location',
    location: {
      latitude : loc.lat,
      longitude: loc.lng,
      name     : loc.name,
      address  : loc.addr
    }
  };
}

/* ✅ Forzamos nombre para que WhatsApp lo trate como PDF real y no “sin título/HTML” */
export function buildDocument(to, link, filename = 'Indicaciones.pdf') {
  return {
    messaging_product: 'whatsapp',
    to,
    type: 'document',
    document: { link, caption: '📝 Indicaciones', filename }
  };
}
