import http from "k6/http";
import { check } from "k6";

const targetUrl = `${__ENV.TARGET_URL}/in/${__ENV.ENDPOINT_SLUG || "load"}`;

export const options = {
  summaryTrendStats: ["avg", "min", "med", "max", "p(90)", "p(95)", "p(99)"],
  scenarios: {
    ingest: {
      executor: "constant-arrival-rate",
      rate: Number(__ENV.RATE),
      timeUnit: "1s",
      duration: __ENV.DURATION,
      preAllocatedVUs: 50,
      maxVUs: 300,
    },
  },
  thresholds: {
    "http_req_duration{expected_response:true}": ["p(95)<50"],
    checks: ["rate>0.999"],
  },
};

export default function () {
  // corpo único em cada requisição: sem Idempotency-Key, o hash do corpo é a chave e nenhum evento vira repetido
  const body = JSON.stringify({ id: `${__VU}-${__ITER}-${Date.now()}` });
  const response = http.post(targetUrl, body, {
    headers: { "content-type": "application/json", "x-event-type": "load.test" },
  });
  check(response, { "accepted with 202": (r) => r.status === 202 });
}
