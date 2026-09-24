/**
 * PLACEHOLDER scene (Milestone M0): proves the secure data path end-to-end.
 * Islands = boxes coloured by status, height ~ p95 latency. Replace with the real scene in M1+.
 * See docs/PLAN.md and docs/ARCHITECTURE.md.
 */
import * as THREE from "three";
import "./style.css";
import { MetricsClient } from "./net/client";
import { store } from "./state/store";

const canvas = document.querySelector<HTMLCanvasElement>("#scene");
const status = document.querySelector<HTMLElement>("#hud-status");
if (!canvas || !status) throw new Error("required DOM nodes are missing");

const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: "low-power" });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5)); // biggest low-end win

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x070d14);
scene.fog = new THREE.FogExp2(0x070d14, 0.03);
scene.add(new THREE.AmbientLight(0x88aaff, 0.7));
const sun = new THREE.DirectionalLight(0xffffff, 0.9);
sun.position.set(5, 10, 4);
scene.add(sun);

const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 200);
camera.position.set(0, 9, 16);
camera.lookAt(0, 0, 0);

const COLORS = { ok: 0x3fd0a5, degraded: 0xf2b134, failing: 0xff4d5e } as const;
const geometry = new THREE.BoxGeometry(1.6, 1, 1.6);
const islands = new Map<string, THREE.Mesh<THREE.BoxGeometry, THREE.MeshStandardMaterial>>();

function resize(): void {
  const { clientWidth: w, clientHeight: h } = canvas as HTMLCanvasElement;
  renderer.setSize(w, h, false);
  camera.aspect = w / Math.max(h, 1);
  camera.updateProjectionMatrix();
}
window.addEventListener("resize", resize);
resize();

function syncScene(): void {
  const snap = store.latest;
  if (!snap) return;
  const n = snap.services.length;
  snap.services.forEach((svc, i) => {
    let mesh = islands.get(svc.id);
    if (!mesh) {
      mesh = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ color: COLORS.ok }));
      islands.set(svc.id, mesh);
      scene.add(mesh);
    }
    const angle = (i / n) * Math.PI * 2;
    const height = 0.6 + Math.min(svc.p95_ms / 400, 4);
    mesh.position.set(Math.cos(angle) * 6, height / 2, Math.sin(angle) * 6);
    mesh.scale.y = height;
    mesh.material.color.setHex(COLORS[svc.status]);
  });
}

const client = new MetricsClient({
  onSnapshot: (s) => {
    store.latest = s;
  },
  onState: (s) => {
    store.conn = s;
  },
});
client.start();

let last = 0;
function frame(now: number): void {
  requestAnimationFrame(frame);
  if (document.hidden || now - last < 33) return; // pause when hidden, cap ~30fps
  last = now;
  syncScene();
  status.textContent = store.latest ? `${store.conn} · seq ${store.latest.seq}` : store.conn;
  renderer.render(scene, camera);
}
requestAnimationFrame(frame);
