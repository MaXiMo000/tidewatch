// k6 load test for the WebSocket stream (docs/SECURITY.md s.7: "connection caps and rate limits
// verified under k6 load; memory flat"). Run against the compose stack, from ONE client IP:
//
//   docker run --rm --network host -e BASE=https://localhost \
//     -v "$PWD/scripts/load:/load:ro" grafana/k6@sha256:<pinned> run --insecure-skip-tls-verify /load/ws.js
//
// 20 viewers arrive at once and each tries to hold a stream for 20 s. The per-IP connection cap
// (TIDEWATCH_WS_MAX_PER_IP, default 5) must admit at most 5 of them at a time and turn the rest
// away; every admitted viewer must receive snapshots. A burst of ticket requests beyond the per-IP
// rate must get 429. Thresholds fail the run otherwise. Memory is checked by the CI step around it.
import http from "k6/http";
import ws from "k6/ws";
import { check } from "k6";
import { Counter } from "k6/metrics";

const BASE = __ENV.BASE || "https://localhost";
const ORIGIN = __ENV.ORIGIN || BASE;
const WS_URL = BASE.replace(/^http/, "ws") + "/ws/v1/stream";
const MAX_PER_IP = Number(__ENV.MAX_PER_IP || 5);
const HOLD_MS = Number(__ENV.HOLD_MS || 20000);

const admitted = new Counter("ws_admitted"); // got at least one snapshot
const turnedAway = new Counter("ws_turned_away"); // closed without a snapshot
const snapshots = new Counter("ws_snapshots");
const ticketLimited = new Counter("ticket_429");

export const options = {
  scenarios: {
    viewers: { executor: "per-vu-iterations", vus: 20, iterations: 1, maxDuration: "90s" },
    ticket_burst: {
      executor: "per-vu-iterations",
      vus: 1,
      iterations: 1,
      startTime: "45s",
      exec: "ticketBurst",
    },
  },
  thresholds: {
    ws_admitted: [`count<=${MAX_PER_IP}`, "count>=1"],
    ws_turned_away: ["count>=1"],
    ticket_429: ["count>=1"],
    checks: ["rate==1.0"],
  },
};

export default function () {
  const r = http.post(`${BASE}/api/v1/ws-ticket`, null, { headers: { Origin: ORIGIN } });
  check(r, { "ticket issued": (res) => res.status === 200 });
  if (r.status !== 200) return;
  const ticket = r.json("ticket");
  let got = 0;
  ws.connect(WS_URL, { headers: { Origin: ORIGIN } }, (socket) => {
    socket.on("open", () => socket.send(JSON.stringify({ type: "auth", ticket })));
    socket.on("message", (data) => {
      got += 1;
      snapshots.add(1);
      if (got === 1) check(data, { "snapshot is JSON": (d) => JSON.parse(d).type === "snapshot" });
    });
    socket.setTimeout(() => socket.close(), HOLD_MS);
  });
  if (got > 0) admitted.add(1);
  else turnedAway.add(1);
}

export function ticketBurst() {
  // Far more requests than the per-IP ticket rate allows within a minute.
  for (let i = 0; i < 150; i++) {
    const r = http.post(`${BASE}/api/v1/ws-ticket`, null, { headers: { Origin: ORIGIN } });
    if (r.status === 429) ticketLimited.add(1);
  }
}
