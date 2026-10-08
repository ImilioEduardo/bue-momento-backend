import { describe, it, expect, vi, afterEach, beforeAll, afterAll } from 'vitest';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { BadRequestException, ServiceUnavailableException } from '@nestjs/common';
import { EvolutionNotifier } from './evolution.notifier.js';
import { ConsoleNotifier } from './console.notifier.js';
import { envSchema } from '../../config/env.schema.js';

const TOKEN = '082e98c4ded32527084652b1f9250d01';
const cfg = (o: Record<string, string>) => ({ get: (k: string) => o[k] }) as any;

// Servidor que imita as respostas reais da Evolution API v2.3 (formatos tirados do código-fonte)
let server: Server;
let base = '';
const seen: { url?: string; apikey?: string; body?: any }[] = [];
beforeAll(async () => {
  server = createServer((req, res) => {
    let data = '';
    req.on('data', (c) => (data += c));
    req.on('end', () => {
      const body = data ? JSON.parse(data) : {};
      seen.push({ url: req.url, apikey: req.headers['apikey'] as string, body });
      res.setHeader('Content-Type', 'application/json');
      if (req.headers['apikey'] !== TOKEN) {
        res.statusCode = 401;
        return res.end(JSON.stringify({ status: 401, error: 'Unauthorized', response: { message: 'Unauthorized' } }));
      }
      if (!req.url?.startsWith('/message/sendText/bue-momentos')) {
        res.statusCode = 404;
        return res.end(JSON.stringify({ status: 404, error: 'Not Found', response: { message: ['The "x" instance does not exist'] } }));
      }
      if (body.number === '244911111111') {
        res.statusCode = 400;
        return res.end(JSON.stringify({ status: 400, error: 'Bad Request',
          response: { message: [{ jid: '244911111111@s.whatsapp.net', exists: false, number: '244911111111' }] } }));
      }
      if (body.number === '244922222222') {
        res.statusCode = 500;
        return res.end(JSON.stringify({ status: 500, error: 'Internal Server Error', response: { message: ['Error: Connection Closed'] } }));
      }
      res.statusCode = 201;
      res.end(JSON.stringify({ key: { remoteJid: `${body.number}@s.whatsapp.net`, fromMe: true, id: '3EB0ABC' }, status: 'PENDING' }));
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => new Promise<void>((r) => server.close(() => r())));
afterEach(() => vi.restoreAllMocks());

const mk = (o: Record<string, string> = {}) =>
  new EvolutionNotifier(cfg({ EVOLUTION_API_URL: base + '/', EVOLUTION_API_KEY: TOKEN, EVOLUTION_INSTANCE: 'bue-momentos', ...o }), new ConsoleNotifier());
const quiet = (n: EvolutionNotifier) => ({
  error: vi.spyOn((n as any).logger, 'error').mockImplementation(() => {}),
  warn: vi.spyOn((n as any).logger, 'warn').mockImplementation(() => {}),
  log: vi.spyOn((n as any).logger, 'log').mockImplementation(() => {}),
});

describe('EvolutionNotifier', () => {
  it('POST /message/sendText/{instância} com apikey da instância e número só em dígitos com 244', async () => {
    const n = mk();
    const spies = quiet(n);
    await n.sendSms('944 916 156', 'Bué Momentos: o teu código é 123456. Válido 10 min.');
    const last = seen.at(-1)!;
    expect(last.url).toBe('/message/sendText/bue-momentos');
    expect(last.apikey).toBe(TOKEN);
    expect(last.body).toEqual({ number: '244944916156', text: 'Bué Momentos: o teu código é 123456. Válido 10 min.', linkPreview: false });
    const logged = spies.log.mock.calls.flat().join(' ');
    expect(logged).toContain('id=3EB0ABC');
    expect(logged).not.toMatch(/944916156|123456/);
  });

  it('aceita +244… e 244… sem duplicar o indicativo', async () => {
    const n = mk();
    quiet(n);
    await n.sendSms('+244944916156', 'x');
    expect(seen.at(-1)!.body.number).toBe('244944916156');
    await n.sendSms('244944916156', 'x');
    expect(seen.at(-1)!.body.number).toBe('244944916156');
  });

  it('número sem WhatsApp → 400 WHATSAPP_NOT_FOUND', async () => {
    const n = mk();
    const spies = quiet(n);
    const err = await n.sendSms('911111111', 'código 482913').catch((e) => e);
    expect(err).toBeInstanceOf(BadRequestException);
    expect(err.getResponse().code).toBe('WHATSAPP_NOT_FOUND');
    expect(spies.warn.mock.calls.flat().join(' ')).not.toMatch(/911111111|482913/);
  });

  it('WhatsApp desligado → 503 SMS_DELIVERY_FAILED com dica no log, sem OTP nem número', async () => {
    const n = mk();
    const spies = quiet(n);
    const err = await n.sendSms('922222222', 'código 482913').catch((e) => e);
    expect(err).toBeInstanceOf(ServiceUnavailableException);
    expect(err.getResponse().code).toBe('SMS_DELIVERY_FAILED');
    const logged = spies.error.mock.calls.flat().join(' ');
    expect(logged).toContain('HTTP 500');
    expect(logged).toContain('lê o QR de novo');
    expect(logged).not.toMatch(/922222222|482913/);
  });

  it('token errado → 503 e dica de EVOLUTION_API_KEY', async () => {
    const n = mk({ EVOLUTION_API_KEY: 'errado-errado-errado' });
    const spies = quiet(n);
    const err = await n.sendSms('944916156', 'x').catch((e) => e);
    expect(err).toBeInstanceOf(ServiceUnavailableException);
    expect(spies.error.mock.calls.flat().join(' ')).toContain('EVOLUTION_API_KEY errada');
  });

  it('instância errada → 503 e dica de EVOLUTION_INSTANCE', async () => {
    const n = mk({ EVOLUTION_INSTANCE: 'outra' });
    const spies = quiet(n);
    await expect(n.sendSms('944916156', 'x')).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(spies.error.mock.calls.flat().join(' ')).toContain('EVOLUTION_INSTANCE');
  });

  it('Evolution em baixo → 503 (não rebenta com erro de rede)', async () => {
    const n = mk({ EVOLUTION_API_URL: 'http://127.0.0.1:1' });
    const spies = quiet(n);
    const err = await n.sendSms('944916156', 'x').catch((e) => e);
    expect(err).toBeInstanceOf(ServiceUnavailableException);
    const logged = spies.error.mock.calls.flat().join(' ');
    expect(logged).toContain('inacessivel em http://127.0.0.1:1');
    expect(logged).toContain('ECONNREFUSED');
  });
});

describe('env.schema com SMS_PROVIDER=evolution', () => {
  const dev = {
    NODE_ENV: 'development', DATABASE_URL: 'postgres://x', JWT_ACCESS_SECRET: 'a'.repeat(32), JWT_GUEST_SECRET: 'c'.repeat(32),
    WEB_URL: 'http://localhost:3000', PUBLIC_WEB_URL: 'http://localhost:3000', REDIS_URL: 'redis://localhost:6379',
  };
  const evo = { SMS_PROVIDER: 'evolution', EVOLUTION_API_URL: 'http://localhost:8080', EVOLUTION_API_KEY: TOKEN, EVOLUTION_INSTANCE: 'bue-momentos' };

  it('aceita configuração completa em dev', () => {
    expect(envSchema.validate({ ...dev, ...evo }, { allowUnknown: true }).error).toBeUndefined();
  });
  it('recusa sem URL ou sem token', () => {
    const e1 = envSchema.validate({ ...dev, ...evo, EVOLUTION_API_URL: '' }, { allowUnknown: true }).error;
    expect(e1?.message).toContain('EVOLUTION_API_URL');
    const e2 = envSchema.validate({ ...dev, ...evo, EVOLUTION_API_KEY: '' }, { allowUnknown: true }).error;
    expect(e2?.message).toContain('EVOLUTION_API_KEY');
  });
  it('em produção exige https, salvo host privado *.internal', () => {
    const prod = {
      ...dev, NODE_ENV: 'production', WEB_URL: 'https://bue.ao', PUBLIC_WEB_URL: 'https://bue.ao',
      ADMIN_SECRET: 'x'.repeat(64), ADMIN_PASSWORD: 'y'.repeat(20),
    };
    const httpPublic = envSchema.validate({ ...prod, ...evo, EVOLUTION_API_URL: 'http://evo.bue.ao' }, { allowUnknown: true }).error;
    expect(httpPublic?.message).toContain('https://');
    for (const ok of ['https://evo.bue.ao', 'http://evolution.railway.internal:8080']) {
      const msg = envSchema.validate({ ...prod, ...evo, EVOLUTION_API_URL: ok }, { allowUnknown: true }).error?.message ?? '';
      expect(msg).not.toContain('EVOLUTION');
    }
  });
});
