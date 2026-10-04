/**
 * Load test: 2 800 upload URL requests (POST /public/assignments/:aid/uploads)
 * Target: p(95) < 3000 ms, error rate < 1%
 *
 * Prerequisites: run join.k6.js first and collect assignment IDs.
 * Set ASSIGNMENT_IDS to a comma-separated list of assignment IDs.
 *
 * Usage:
 *   k6 run -e BASE_URL=https://api.buemoomentos.ao/api/v1 \
 *          -e ASSIGNMENT_IDS=aid1,aid2,aid3 \
 *          -e GUEST_TOKEN=eyJ... \
 *          test/load/uploads.k6.js
 */
import http from 'k6/http';
import { sleep, check } from 'k6';

export const options = {
  scenarios: {
    upload_urls: {
      executor: 'constant-arrival-rate',
      rate: 560,       // 560 req/min
      timeUnit: '1m',
      duration: '5m',  // 5 min × 560 = 2 800 requests
      preAllocatedVUs: 200,
      maxVUs: 300,
    },
  },
  thresholds: {
    http_req_failed: ['rate<0.01'],
    http_req_duration: ['p(95)<3000'],
  },
};

const BASE_URL = __ENV.BASE_URL || 'http://localhost:3001/api/v1';
const ASSIGNMENT_IDS = (__ENV.ASSIGNMENT_IDS || '').split(',').filter(Boolean);
const GUEST_TOKEN = __ENV.GUEST_TOKEN || '';

export default function () {
  if (ASSIGNMENT_IDS.length === 0) {
    console.error('No ASSIGNMENT_IDS provided — set -e ASSIGNMENT_IDS=id1,id2,...');
    return;
  }

  const aid = ASSIGNMENT_IDS[__ITER % ASSIGNMENT_IDS.length];
  const payload = JSON.stringify({
    mediaType: 'VIDEO',
    uploadLength: 5 * 1024 * 1024, // 5 MB
  });

  const res = http.post(`${BASE_URL}/public/assignments/${aid}/uploads`, payload, {
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${GUEST_TOKEN}`,
    },
    tags: { name: 'upload_url' },
  });

  const ok = check(res, {
    'status 201': (r) => r.status === 201,
    'has tusUploadUrl or putUrl': (r) => {
      try {
        const body = JSON.parse(r.body);
        return !!(body.tusUploadUrl || body.putUrl);
      } catch { return false; }
    },
  });

  if (!ok) console.error(`upload url failed: ${res.status} ${res.body}`);

  sleep(Math.random() * 0.1);
}
