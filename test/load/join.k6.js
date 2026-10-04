/**
 * Load test: 400 join requests in 5 minutes
 * Target: p(95) < 2000 ms, error rate < 1%
 *
 * Usage:
 *   k6 run -e BASE_URL=https://api.buemoomentos.ao/api/v1 \
 *          -e EVENT_CODE=abc123 \
 *          test/load/join.k6.js
 */
import http from 'k6/http';
import { sleep, check } from 'k6';
import { Counter } from 'k6/metrics';

const duplicateJoins = new Counter('duplicate_joins');

export const options = {
  scenarios: {
    join_wave: {
      executor: 'constant-arrival-rate',
      rate: 80,        // 80 requests/min
      timeUnit: '1m',
      duration: '5m',  // 5 min × 80 = 400 joins
      preAllocatedVUs: 100,
      maxVUs: 150,
    },
  },
  thresholds: {
    http_req_failed: ['rate<0.01'],
    http_req_duration: ['p(95)<2000'],
  },
};

const BASE_URL = __ENV.BASE_URL || 'http://localhost:3001/api/v1';
const EVENT_CODE = __ENV.EVENT_CODE || 'testcode';

export default function () {
  const uid = `${__VU}_${__ITER}_${Date.now()}`;
  const payload = JSON.stringify({
    name: `Convidado ${uid}`,
    phone: `+2449${String((__VU * 1000 + __ITER) % 100000000).padStart(8, '0')}`,
    deviceId: `device_${uid}`,
    consentAccepted: true,
  });

  const res = http.post(`${BASE_URL}/public/events/${EVENT_CODE}/join`, payload, {
    headers: { 'Content-Type': 'application/json' },
    tags: { name: 'join' },
  });

  const ok = check(res, {
    'status 201': (r) => r.status === 201,
    'has guestToken': (r) => {
      try { return !!JSON.parse(r.body).guestToken; } catch { return false; }
    },
  });

  if (res.status === 409) duplicateJoins.add(1);
  if (!ok) console.error(`join failed: ${res.status} ${res.body}`);

  sleep(Math.random() * 0.5);
}
