// Builds docs/figures/ontomark-anatomy.svg (static, light/dark via prefers-color-scheme)
// and a verification page that wraps the identical SVG in an .iso-plate.
//   node build.mjs   (then: CHROME_PATH=<chromium> node scripts/lines.mjs verify-light.html)
// kit/ and scripts/ are copied unmodified from the anatomy skill (MIT).
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import * as k from "./kit/iso-kit.mjs";
import { NOTES, INDEXED, REASONED, COUNTS, rowsOf, QUERY_MODES, INGEST_NOTE, PATCHED, WITHHELD } from "./model.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, "..");

const W = 1000;
const DRAW_H = 470;
const TOP = 54;

// ---------------------------------------------------------------- world plan
const BASE = { x: -300, y: -100, w: 610, d: 200, r: 10 };
const BASE_H = 12;
const FOOT_H = 5;

const TRAY = { x: -282, y: -82, w: 58, d: 66, r: 3 };
const GATE_X = -196;
const DRUM = [-118, -50];
const DRUM_R = 26;
const BOX = { x: -58, y: -88, w: 96, d: 70, r: 4 };
const GRAPH = { x: -282, y: 14, w: 136, d: 76, r: 3 };
const CAB = { x: -120, y: 30, w: 58, d: 44, r: 3 };
const DIAL = [-12, 56];
const DIFF = { x: 62, y: 8, w: 108, d: 60, r: 4 };
const ING = { x: 180, y: -86, w: 118, d: 172, r: 6 };

const AZ = Number(process.env.AZ ?? 62);
const P = k.fitProjection(
  [...k.boxCorners(BASE, -BASE_H - FOOT_H, 0), [DRUM[0], DRUM[1], 74], [ING.x + 40, ING.y + 40, 96], [GATE_X, -50, 70]],
  W,
  DRAW_H,
  { pad: 26, azimuth: AZ, elevation: 30 },
);

const at = (p) => k.iso(p, P);
const S = (paths, style) => k.solidSvg(paths, style);
const L = (d, style) => k.lineSvg(d, style);
const D = (pts, style) => k.dotsSvg(pts, style);
const depth = (x, y, z = 0) => k.depthOf([x, y, z], P);
const byDepth = (pts) => [...pts].sort((a, b) => depth(a[0], a[1]) - depth(b[0], b[1]));
const screws = (plan, inset, z, size = 0.5) => D(k.corners(plan, inset).map(([x, y]) => at([x, y, z])), { size, tone: "mid" });

/** A small engraved numeral plate lying on a top face: the key to the legend. */
function badge(n, x, y, z) {
  const plan = { x: x - 6, y: y - 6, w: 12, d: 12, r: 2 };
  return (
    S(k.slabOf(plan, z, 1, P, 3, 0.3), { tone: "mid" }) +
    k.faceTextSvg(k.topMatrix([x - 2.6, y + 3.4], z + 1, P, "x"), String(n), { size: 9, tone: "hi" })
  );
}

/** A note card lying flat. `tab` = it carries a typed frontmatter tab. */
function card(x, y, z, { tab = true, lit = false, w = 30, d = 40 } = {}) {
  const plan = { x: x - w / 2, y: y - d / 2, w, d, r: 1.2 };
  let out = S(k.slabOf(plan, z, 1.4, P, 2, 0.3), { tone: "hi", crease: "lo", lit });
  // frontmatter block: a ruled header, then prose lines (stand for text)
  const top = z + 1.4;
  const x0 = plan.x + 3;
  if (tab) {
    out += L(k.planOutline({ x: x0, y: plan.y + 3, w: w - 6, d: 9, r: 0.8 }, top, P, 2), { tone: "mid" });
    out += L([0, 1].map((i) => k.lineOnTop([x0 + 2, plan.y + 6 + i * 3], [x0 + 12 - i * 4, plan.y + 6 + i * 3], top, P)).join(""), { tone: "mid", free: true });
  }
  out += L([0, 1, 2, 3].map((i) => k.lineOnTop([x0, plan.y + 16 + i * 5], [x0 + (i % 2 ? 16 : 22), plan.y + 16 + i * 5], top, P)).join(""), { tone: "lo", free: true });
  if (tab) out += S(k.slabOf({ x: plan.x + w - 9, y: plan.y - 4, w: 7, d: 5, r: 1 }, z, 1.4, P, 2), { tone: "hi", crease: "lo", lit });
  return out;
}

// ---------------------------------------------------------------- base
function base() {
  const out = [`<path class="iso-halo" d="${k.haloOf(BASE, -BASE_H - FOOT_H, BASE_H, P)}"/>`];
  for (const [x, y] of byDepth(k.corners(BASE, 24))) {
    out.push(S(k.cylinder(x, y, 8, -BASE_H - FOOT_H, 1.6, P, 28), { tone: "lo" }));
    out.push(S(k.cylinder(x, y, 6, -BASE_H - FOOT_H + 1.6, FOOT_H - 1.6, P, 28), { tone: "mid" }));
  }
  out.push(S(k.slabOf(BASE, -BASE_H, BASE_H, P, 8, 1.6), { tone: "mid", inner: L(k.sideSeam(BASE, -5, P, 8), { tone: "faint" }) }));
  out.push(L(k.planOutline(k.insetPlan(BASE, 5), 0, P), { tone: "lo" }));
  const sc = k.corners(BASE, 11);
  out.push(L(sc.map(([x, y]) => k.ring(x, y, 2.4, 0, P, 16)).join(""), { tone: "lo" }));
  out.push(D(sc.map(([x, y]) => at([x, y, 0])), { size: 0.55 }));
  // ruler strip along the front edge
  const strip = { x: -136, y: BASE.y + BASE.d - 14, w: 296, d: 5, r: 1 };
  out.push(S(k.slabOf(strip, 0, 0.6, P, 3), { tone: "lo", crease: "none" }));
  const t = k.topTicks(strip.x + 5, strip.x + strip.w - 5, 5, 5, strip.y + 0.8, 0.6, [2, 3.6], P);
  out.push(L(t.minor, { tone: "lo" }), L(t.major, { tone: "mid" }));
  // the optional module's bolt-on footprint: a dashed closed outline on the base
  out.push(L(k.planOutline(k.insetPlan(ING, -5), 0, P, 6), { tone: "mid", dashed: true }));
  return out.join("");
}

// ---------------------------------------------------------------- wires on the base (drawn under the stations)
function wires() {
  const z = 0.4;
  const w = (pts, style = {}) => k.wireSvg(at([...pts[0], z]), at([...pts[pts.length - 1], z]), { via: pts.slice(1, -1).map((p) => at([...p, z])), tone: "mid", ...style });
  return [
    // stage 1 → reasoner
    w([[DRUM[0] + DRUM_R + 6, DRUM[1]], [BOX.x - 1, DRUM[1]]]),
    // reasoner → three readouts
    w([[BOX.x + 20, BOX.y + BOX.d + 1], [BOX.x + 20, 6], [GRAPH.x + GRAPH.w / 2, 6], [GRAPH.x + GRAPH.w / 2, GRAPH.y - 1]]),
    w([[BOX.x + 36, BOX.y + BOX.d + 1], [BOX.x + 36, 14], [CAB.x + CAB.w / 2, 14], [CAB.x + CAB.w / 2, CAB.y - 1]]),
    w([[BOX.x + 52, BOX.y + BOX.d + 1], [BOX.x + 52, 22], [DIAL[0], 22], [DIAL[0], DIAL[1] - 19]]),
    // reviewed edit: diff window writes back to the notes in the tray (front lane)
    w([[DIFF.x + 20, DIFF.y + DIFF.d + 1], [DIFF.x + 20, 93.5], [BASE.x + 9, 93.5], [BASE.x + 9, TRAY.y + 30], [TRAY.x - 1, TRAY.y + 30]], { tone: "hi" }),
    // optional ingest → the same diff gate
    w([[ING.x + 6, 38], [DIFF.x + DIFF.w + 1, 38]], { dashed: true }),
  ].join("");
}

const ON_BELT = INDEXED.entities.find((e) => e.type === "individual");
const IN_BIN = INDEXED.ignored[0];
const STACK = NOTES.filter((n) => n !== ON_BELT && n !== IN_BIN);
if (STACK.length + 2 !== COUNTS.notes) throw new Error("card count drifted from the model");

// ---------------------------------------------------------------- 1 input tray with note cards
function tray() {
  const out = [];
  out.push(S(k.slabOf(TRAY, 0, 2, P, 4, 0.5), { tone: "lo" }));
  // low walls: back, left, right (front left open so cards are seen)
  out.push(S(k.slabOf({ x: TRAY.x, y: TRAY.y, w: TRAY.w, d: 3, r: 1 }, 2, 9, P, 2, 0.4), { tone: "mid" }));
  out.push(S(k.slabOf({ x: TRAY.x, y: TRAY.y, w: 3, d: TRAY.d, r: 1 }, 2, 9, P, 2, 0.4), { tone: "mid" }));
  // stack of note cards, one per NOTES entry, bottom to top
  // the tray holds every note except the one on the belt and the one in the ignored bin
  STACK.forEach((note, i) => out.push(card(TRAY.x + 31 + (i % 2) * 1.5, TRAY.y + 35 - (i % 3), 2 + i * 1.6, { tab: Boolean(note.type) })));
  out.push(badge(1, TRAY.x + 8, TRAY.y + TRAY.d - 7, 2));
  return out.join("");
}

// ---------------------------------------------------------------- 2 typed-frontmatter gate (+ ignored bin)
function gate() {
  const out = [];
  const y0 = -82, y1 = -18;
  const foot = (y) => S(k.slabOf({ x: GATE_X - 6, y: y - 6, w: 12, d: 12, r: 2 }, 0, 4, P, 3, 0.5), { tone: "mid" });
  const post = (y) => S(k.cylinder(GATE_X, y, 3, 4, 52, P, 20), { tone: "mid", crease: "none" });
  out.push(foot(y0), post(y0));
  // crossbar with a comb that only a tab can pass under
  out.push(S(k.slabOf({ x: GATE_X - 4, y: y0 - 4, w: 8, d: y1 - y0 + 8, r: 2 }, 56, 7, P, 3, 0.5), { tone: "mid" }));
  out.push(D([y0, y1].map((y) => at([GATE_X, y, 63])), { size: 0.5 }));
  for (let i = 0; i < 9; i++) out.push(S(k.slabOf({ x: GATE_X - 1, y: y0 + 8 + i * 6, w: 2, d: 2, r: 0.6 }, 22, 34, P, 2), { tone: "lo", crease: "none" }));
  out.push(foot(y1), post(y1));
  // a typed card passing through
  out.push(card(GATE_X + 2, -50, 4, { tab: true }));
  // the ignored bin for the untyped note, beside the gate (not an assertion, never read)
  const bin = { x: GATE_X - 24, y: -9, w: 38, d: 21, r: 3 };
  out.push(S(k.slabOf(bin, 0, 2, P, 3), { tone: "lo" }));
  out.push(S(k.slabOf({ x: bin.x, y: bin.y, w: bin.w, d: 2.5, r: 1 }, 2, 6, P, 2), { tone: "lo" }));
  out.push(card(bin.x + 19, bin.y + 11.5, 2, { tab: false, w: 28, d: 15 }));
  out.push(badge(2, GATE_X + 14, y1 + 2, 0));
  return out.join("");
}

// ---------------------------------------------------------------- belt: tray → gate → drum
function belt() {
  const plan = { x: TRAY.x + TRAY.w + 2, y: -64, w: DRUM[0] - DRUM_R - 8 - (TRAY.x + TRAY.w + 2), d: 28, r: 3 };
  const out = [];
  for (const y of [plan.y - 3, plan.y + plan.d]) out.push(S(k.slabOf({ x: plan.x, y, w: plan.w, d: 3, r: 1 }, 0, 6, P, 2, 0.4), { tone: "mid" }));
  out.push(S(k.slabOf(plan, 0, 4, P, 3), { tone: "lo", crease: "lo" }));
  const t = k.topTicks(plan.x + 3, plan.x + plan.w - 3, 6, 100, plan.y, 4, [plan.d, plan.d], P);
  out.push(L(t.minor + t.major, { tone: "faint" }));
  out.push(D([plan.x + 4, plan.x + plan.w - 4].flatMap((x) => [at([x, plan.y - 1.5, 6]), at([x, plan.y + plan.d + 1.5, 6])]), { size: 0.45 }));
  return out.join("");
}

// ---------------------------------------------------------------- 3 indexer drum (vertical carousel)
function drum() {
  const [x, y] = DRUM;
  const out = [`<path class="iso-halo" d="${k.haloOf({ x: x - 30, y: y - 30, w: 60, d: 60, r: 30 }, 0, 2, P)}"/>`];
  out.push(S(k.cylinder(x, y, DRUM_R + 6, 0, 6, P, 72, 0.6), { tone: "mid" }));
  out.push(L(k.radialTicks(x, y, DRUM_R + 5, 48, 4, 6, [1.2, 2.4], P).minor, { tone: "lo" }));
  out.push(S(k.cylinder(x, y, DRUM_R, 6, 52, P, 72, 0.8), { tone: "hi", crease: "lo", inner: L([20, 32, 44].map((z) => k.sideArc(x, y, DRUM_R, z, P, 40)).join(""), { tone: "faint" }) }));
  out.push(L(k.knurl(x, y, DRUM_R, 52, 58, 64, P, 0.3), { tone: "lo" }));
  // index slots on the top: one per entity minted
  const tt = k.radialTicks(x, y, DRUM_R, 32, 8, 58, [3, 6], P);
  out.push(L(tt.minor, { tone: "lo" }), L(tt.major, { tone: "mid" }));
  out.push(L(k.ring(x, y, DRUM_R - 6, 58, P, 64), { tone: "lo" }));
  out.push(S(k.cylinder(x, y, 7, 58, 6, P, 32, 0.5), { tone: "mid" }));
  out.push(L(k.knurl(x, y, 7, 58, 64, 28, P), { tone: "lo" }));
  out.push(S(k.cylinder(x, y, 2.6, 64, 8, P, 16), { tone: "mid" }));
  // label plate on the plinth
  out.push(badge(3, x + 26, y + 18, 6));
  return out.join("");
}

// ---------------------------------------------------------------- 4 reasoner gearbox (background worker)
const GEARS = [
  { x: BOX.x + 26, y: BOX.y + 32, r: 18, n: 36, lit: true },
  { x: 0, y: 0, r: 11, n: 22 },
  { x: 0, y: 0, r: 8, n: 16 },
];
GEARS[1].x = GEARS[0].x + GEARS[0].r + GEARS[1].r + 0.4;
GEARS[1].y = GEARS[0].y + 8;
{
  const dx = 7;
  GEARS[2].x = GEARS[1].x + dx;
  GEARS[2].y = GEARS[1].y - Math.sqrt((GEARS[1].r + GEARS[2].r + 0.4) ** 2 - dx * dx);
}
function gearbox() {
  const out = [`<path class="iso-halo" d="${k.haloOf(BOX, 0, 2, P)}"/>`];
  const H = 20;
  out.push(S(k.slabOf(BOX, 0, H, P, 6, 0.8), { tone: "mid", inner: L(k.sideSeam(BOX, 6, P, 6), { tone: "faint" }) }));
  const well = k.insetPlan(BOX, 6);
  out.push(S(k.slabOf(well, H - 0.1, 0.1, P, 6), { tone: "lo", flat: true, crease: "none" }));
  out.push(L(k.planOutline(well, H, P, 6), { tone: "lo" }));
  out.push(screws(BOX, 3.2, H, 0.5));
  for (const g of [...GEARS].sort((a, b) => depth(a.x, a.y) - depth(b.x, b.y))) {
    out.push(S(k.cylinder(g.x, g.y, g.r, H, 4, P, 56, 0.4), { tone: "hi", crease: "lo", lit: g.lit }));
    const teeth = k.radialTicks(g.x, g.y, g.r, g.n, 1, H + 4, [2, 2], P);
    out.push(L(teeth.major, { tone: g.lit ? "lit" : "mid" }));
    out.push(L(k.ring(g.x, g.y, g.r - 2, H + 4, P, 40), { tone: "lo" }));
    out.push(S(k.cylinder(g.x, g.y, 2.4, H + 4, 3, P, 16), { tone: "mid" }));
  }
  // drive shaft and crank on the far end, worker housing tag
  out.push(S(k.slabOf({ x: BOX.x + BOX.w - 18, y: BOX.y + 8, w: 12, d: 18, r: 2 }, H, 10, P, 3, 0.5), { tone: "mid" }));
  out.push(S(k.cylinder(BOX.x + BOX.w - 12, BOX.y + 17, 4, H + 10, 5, P, 24), { tone: "mid" }));
  out.push(L(k.knurl(BOX.x + BOX.w - 12, BOX.y + 17, 4, H + 10, H + 15, 18, P), { tone: "lo" }));
  out.push(badge(4, BOX.x + 12, BOX.y + BOX.d - 11, H));
  return out.join("");
}

// ---------------------------------------------------------------- 5 graph plate: asserted solid, inferred dashed
const NODE_AT = { Animal: [0.14, 0.5], Mammal: [0.42, 0.5], Dog: [0.7, 0.22], Cat: [0.7, 0.78], Rex: [0.9, 0.22] };
function graph() {
  const out = [`<path class="iso-halo" d="${k.haloOf(GRAPH, 0, 2, P)}"/>`];
  const z = 6;
  out.push(S(k.slabOf(GRAPH, 0, z, P, 4, 0.8), { tone: "mid" }));
  out.push(L(k.planOutline(k.insetPlan(GRAPH, 3), z, P, 4), { tone: "faint" }));
  out.push(screws(GRAPH, 3, z, 0.45));
  const pos = (name) => [GRAPH.x + NODE_AT[name][0] * GRAPH.w, GRAPH.y + NODE_AT[name][1] * GRAPH.d];
  const R = 4;
  const edge = (e, dashed) => {
    const [ax, ay] = pos(e.from), [bx, by] = pos(e.to);
    const len = Math.hypot(bx - ax, by - ay);
    const ux = (bx - ax) / len, uy = (by - ay) / len;
    // inferred edges bow so they don't sit on top of the asserted chain
    if (!dashed) return L(k.lineOnTop([ax + ux * R, ay + uy * R], [bx - ux * R, by - uy * R], z, P), { tone: "hi" });
    const bow = 9, mx = (ax + bx) / 2 - uy * bow, my = (ay + by) / 2 + ux * bow;
    const pts = [];
    for (let i = 0; i <= 400; i++) {
      const t = i / 400;
      pts.push([(1 - t) ** 2 * ax + 2 * (1 - t) * t * mx + t * t * bx, (1 - t) ** 2 * ay + 2 * (1 - t) * t * my + t * t * by]);
    }
    const trimmed = pts.filter(([px, py]) => Math.hypot(px - ax, py - ay) > R && Math.hypot(px - bx, py - by) > R);
    return L(k.onTop(trimmed, z, P), { tone: "mid", dashed: true });
  };
  INDEXED.asserted.forEach((e) => out.push(edge(e, false)));
  REASONED.inferred.forEach((e) => out.push(edge(e, true)));
  for (const name of Object.keys(NODE_AT).sort((a, b) => depth(...pos(a)) - depth(...pos(b)))) {
    const [x, y] = pos(name);
    const individual = INDEXED.entities.find((e) => e.name === name).type === "individual";
    out.push(L(k.ring(x, y, R, z, P, 28), { tone: "mid" }));
    out.push(individual ? S(k.slabOf({ x: x - 3, y: y - 3, w: 6, d: 6, r: 0.6 }, z, 5, P, 2), { tone: "hi", crease: "lo" }) : S(k.cylinder(x, y, 3, z, 5, P, 24, 0.4), { tone: "hi", crease: "lo" }));
  }
  out.push(badge(5, GRAPH.x + GRAPH.w - 10, GRAPH.y + GRAPH.d - 10, z));
  return out.join("");
}

// ---------------------------------------------------------------- 6 ontology panel: a cabinet of four drawers
const DRAWERS = [
  ["classes", COUNTS.classes],
  ["individuals", COUNTS.individuals],
  ["properties", COUNTS.properties],
  ["diagnostics", COUNTS.diagnostics],
];
function cabinet() {
  const out = [`<path class="iso-halo" d="${k.haloOf(CAB, 0, 2, P)}"/>`];
  const H = 56;
  out.push(S(k.slabOf(CAB, 0, H, P, 4, 0.8), { tone: "mid" }));
  out.push(screws(CAB, 3, H, 0.45));
  // drawer fronts on the +y face (faces the viewer), each with a pull and a card holder
  const front = CAB.y + CAB.d;
  const dh = (H - 8) / 4;
  DRAWERS.forEach(([, count], i) => {
    const z0 = 4 + (3 - i) * dh;
    const fx = { x: CAB.x + 4, y: front, w: CAB.w - 8, d: 1.6, r: 0.6 };
    out.push(S(k.slabOf(fx, z0 + 0.8, dh - 1.6, P, 2, 0.3), { tone: count ? "hi" : "mid", crease: "lo" }));
    const mid = CAB.x + CAB.w / 2;
    out.push(S(k.slabOf({ x: mid - 7, y: front + 1.6, w: 14, d: 1.4, r: 0.5 }, z0 + dh / 2 - 1.2, 2.4, P, 2), { tone: "mid" }));
    // card holder with one rule mark per entity filed
    const hz = z0 + dh - 3.2;
    out.push(L(k.pathOf([[CAB.x + 8, front + 1.6, hz], [CAB.x + 22, front + 1.6, hz], [CAB.x + 22, front + 1.6, hz - 4], [CAB.x + 8, front + 1.6, hz - 4]].map(at), true), { tone: "lo" }));
    for (let j = 0; j < count; j++) out.push(D([at([CAB.x + 10.5 + j * 3, front + 1.6, hz - 2])], { size: 0.7, tone: "hi" }));
  });
  out.push(badge(6, CAB.x + 12, CAB.y + 12, H));
  return out.join("");
}

// ---------------------------------------------------------------- 7 SPARQL selector: stated / inferred / both
const MODES = QUERY_MODES;
const MODE = "combined";
function dial() {
  const [x, y] = DIAL;
  const out = [`<path class="iso-halo" d="${k.haloOf({ x: x - 20, y: y - 20, w: 40, d: 40, r: 20 }, 0, 2, P)}"/>`];
  out.push(S(k.cylinder(x, y, 19, 0, 8, P, 64, 0.8), { tone: "mid" }));
  out.push(L(k.ring(x, y, 17, 8, P, 64), { tone: "lo" }));
  // three detents over a 120° sweep
  const from = -Math.PI / 3;
  const span = (2 * Math.PI) / 3;
  const det = k.radialTicks(x, y, 16, 2, 1, 8, [4, 4], P, from, span);
  out.push(L(det.major, { tone: "hi" }));
  out.push(S(k.cylinder(x, y, 9, 8, 6, P, 40, 0.5), { tone: "hi", crease: "lo" }));
  out.push(L(k.knurl(x, y, 9, 8, 14, 40, P, 0.3), { tone: "lo" }));
  const a = from + (MODES.indexOf(MODE) / 2) * span;
  out.push(L(k.lineOnTop([x, y], [x + Math.sin(a) * 8, y - Math.cos(a) * 8], 14, P), { tone: "hi", free: "end" }));
  out.push(D([at([x, y, 14])], { size: 0.9, tone: "hi" }));
  // a result counter beside the knob: one window, one digit
  const box = { x: x + 22, y: y - 12, w: 18, d: 24, r: 2 };
  out.push(S(k.slabOf(box, 0, 14, P, 3, 0.5), { tone: "mid" }));
  out.push(`<path class="om-glass" d="${k.onTop(k.ringOf(k.insetPlan(box, 3), 2), 14, P, true)}"/>`);
  out.push(L(k.planOutline(k.insetPlan(box, 3), 14, P, 2), { tone: "mid" }));
  out.push(k.faceTextSvg(k.topMatrix([box.x + 4.5, box.y + 15.5], 14, P, "x"), String(rowsOf(MODE)).padStart(2, "0"), { size: 8, tone: "hi" }));
  out.push(badge(7, x - 10, y + 24, 0));
  return out.join("");
}

// ---------------------------------------------------------------- 8 reviewed edit: diff window, Apply lever, digest latch
function diff() {
  const out = [`<path class="iso-halo" d="${k.haloOf(DIFF, 0, 2, P)}"/>`];
  const H = 62;
  out.push(S(k.slabOf(DIFF, 0, H, P, 6, 0.8), { tone: "mid" }));
  out.push(screws(DIFF, 3.2, H, 0.5));
  // the window on the +y face, in the face plane
  const face = DIFF.y + DIFF.d;
  const M = k.sideMatrix([0, face], 0, P, "left");
  const win = { x0: DIFF.x + 8, x1: DIFF.x + DIFF.w - 8, z0: 14, z1: 54 };
  const rr = k.pathOf(k.roundedPlan({ x: win.x0, y: win.z0, w: win.x1 - win.x0, d: win.z1 - win.z0, r: 3 }, 4).map(([u, v]) => [u, -v]), true);
  out.push(`<g transform="${M}"><clipPath id="om-win"><path d="${rr}"/></clipPath><path d="${rr}" class="om-glass"/><g clip-path="url(#om-win)">`);
  const lines = [
    [" ", "is-a: [[Mammal]]", "lo"],
    ["+", `${PATCHED[0].key}: [[${PATCHED[0].value}]]`, "hi"],
  ];
  lines.forEach(([sign, text, tone], i) => {
    const yy = -(win.z1 - 11 - i * 10);
    out.push(`<text class="iso-face-text" data-tone="${tone}" x="${win.x0 + 5}" y="${yy}" font-size="5.4">${sign} ${text}</text>`);
  });
  out.push(`</g><path d="${rr}" class="iso-line" data-tone="mid"/></g>`);
  // Apply lever in a slot on the top, with a knob
  const slot = { x: DIFF.x + DIFF.w - 22, y: DIFF.y + 10, w: 6, d: 30, r: 3 };
  out.push(L(k.planOutline(slot, H, P, 4), { tone: "lo" }));
  out.push(S(k.cylinder(slot.x + 3, slot.y + 8, 1.6, H, 26, P, 16), { tone: "mid", crease: "none" }));
  out.push(S(k.cylinder(slot.x + 3, slot.y + 8, 4.4, H + 26, 7, P, 28, 0.5), { tone: "hi", crease: "lo" }));
  // digest latch: a block with a pin that drops if the file changed since preview
  out.push(S(k.slabOf({ x: DIFF.x + 10, y: DIFF.y + 12, w: 22, d: 14, r: 2 }, H, 6, P, 3, 0.5), { tone: "mid" }));
  out.push(S(k.cylinder(DIFF.x + 21, DIFF.y + 19, 2.2, H + 6, 6, P, 16), { tone: "hi", crease: "lo" }));
  out.push(badge(8, DIFF.x + 46, DIFF.y + 20, H));
  return out.join("");
}

// ---------------------------------------------------------------- 9 optional bolt-on: assisted ingest
function ingest() {
  const out = [];
  const SUB_H = 6;
  out.push(S(k.slabOf(ING, 0, SUB_H, P, 6, 0.8), { tone: "lo" }));
  out.push(screws(ING, 5, SUB_H, 0.55));
  out.push(L(k.corners(ING, 5).map(([x, y]) => k.ring(x, y, 2.2, SUB_H, P, 16)).join(""), { tone: "lo" }));
  const z = SUB_H;
  // hopper: chunk feed (stepped funnel on a stand), endpoint socket empty, plug parked in a holster
  const hx = ING.x + 34, hy = ING.y + 34;
  out.push(`<path class="iso-halo" d="${k.haloOf({ x: hx - 14, y: hy - 14, w: 28, d: 28, r: 4 }, z, 2, P)}"/>`);
  out.push(S(k.slabOf({ x: hx - 12, y: hy - 12, w: 24, d: 24, r: 2 }, z, 3, P, 3, 0.5), { tone: "mid" }));
  for (const [dx, dy] of byDepth([[-7, -7], [7, -7], [-7, 7], [7, 7]])) out.push(S(k.cylinder(hx + dx, hy + dy, 1.6, z + 3, 18, P, 14), { tone: "mid", crease: "none" }));
  let zz = z + 21;
  for (const [half, h] of [[8, 4], [11, 5], [14, 5], [17, 6]]) {
    out.push(S(k.slabOf({ x: hx - half, y: hy - half, w: half * 2, d: half * 2, r: 2 }, zz, h, P, 3, 0.4), { tone: "mid" }));
    zz += h;
  }
  const rim = zz;
  out.push(`<path class="om-void" d="${k.onTop(k.ringOf({ x: hx - 14.5, y: hy - 14.5, w: 29, d: 29, r: 1.2 }, 3), rim, P, true)}"/>`);
  out.push(L(k.planOutline({ x: hx - 14.5, y: hy - 14.5, w: 29, d: 29, r: 1.2 }, rim, P, 3), { tone: "lo" }));
  // a note chunk dropping in: a card standing on edge in the mouth
  out.push(S(k.slabOf({ x: hx - 9, y: hy - 1, w: 18, d: 2, r: 0.4 }, rim - 4, 14, P, 2, 0.3), { tone: "hi", crease: "lo" }));
  // socket (empty) on the stand, plug parked in its holster
  out.push(S(k.slabOf({ x: hx + 18, y: hy + 14, w: 12, d: 12, r: 2 }, z, 5, P, 3, 0.4), { tone: "mid" }));
  out.push(`<path class="om-void" d="${k.onTop(k.circleRing(hx + 24, hy + 20, 3, 20), z + 5, P, true)}"/>`);
  out.push(L(k.ring(hx + 24, hy + 20, 3, z + 5, P, 20), { tone: "mid" }));
  const hol = { x: ING.x + 80, y: ING.y + 30, w: 20, d: 16, r: 2 };
  out.push(S(k.slabOf(hol, z, 10, P, 3, 0.5), { tone: "mid" }));
  out.push(`<path class="om-void" d="${k.onTop(k.circleRing(hol.x + 10, hol.y + 8, 3.6, 20), z + 10, P, true)}"/>`);
  out.push(L(k.ring(hol.x + 10, hol.y + 8, 3.6, z + 10, P, 20), { tone: "mid" }));
  // endpoint plug seated in the socket: shown switched on
  out.push(S(k.cylinder(hx + 24, hy + 20, 3, z + 5, 6, P, 20), { tone: "mid" }));
  out.push(L(k.knurl(hx + 24, hy + 20, 3, z + 5, z + 11, 16, P), { tone: "lo" }));
  // grounding stamp: anvil with a card, column, stamping head with knob
  const sx = ING.x + 36, sy = ING.y + 122;
  out.push(S(k.slabOf({ x: sx - 6, y: sy - 26, w: 12, d: 9, r: 2 }, z, 4, P, 3, 0.4), { tone: "mid" }));
  out.push(S(k.cylinder(sx, sy - 21.5, 3.2, z + 4, 36, P, 20), { tone: "mid", crease: "none" }));
  out.push(S(k.slabOf({ x: sx - 18, y: sy - 16, w: 36, d: 34, r: 3 }, z, 6, P, 4, 0.6), { tone: "mid" }));
  out.push(card(sx, sy + 1, z + 6, { tab: true, w: 24, d: 28 }));
  out.push(S(k.cylinder(sx, sy - 3, 2.4, z + 26, 14, P, 16), { tone: "mid", crease: "none" }));
  out.push(S(k.cylinder(sx, sy - 3, 7, z + 20, 6, P, 32, 0.5), { tone: "hi", crease: "lo" }));
  out.push(S(k.slabOf({ x: sx - 6, y: sy - 26, w: 12, d: 26, r: 2 }, z + 40, 7, P, 3, 0.5), { tone: "mid" }));
  out.push(S(k.cylinder(sx, sy - 21.5, 3.6, z + 47, 6, P, 20), { tone: "mid" }));
  out.push(L(k.knurl(sx, sy - 21.5, 3.6, z + 47, z + 53, 16, P), { tone: "lo" }));
  // withheld reject tray: one card per withheld proposal
  const wt = { x: ING.x + 72, y: ING.y + 104, w: 34, d: 46, r: 2 };
  out.push(S(k.slabOf(wt, z, 2, P, 3), { tone: "lo" }));
  out.push(S(k.slabOf({ x: wt.x, y: wt.y, w: 2.5, d: wt.d, r: 1 }, z + 2, 7, P, 2), { tone: "lo" }));
  out.push(S(k.slabOf({ x: wt.x, y: wt.y, w: wt.w, d: 2.5, r: 1 }, z + 2, 7, P, 2), { tone: "lo" }));
  WITHHELD.forEach((_, i) => out.push(card(wt.x + 16 + i * 1.5, wt.y + 22 - i * 2, z + 2 + i * 1.6, { tab: false, w: 22, d: 30 })));
  out.push(badge(9, ING.x + 18, ING.y + ING.d - 16, z));
  return out.join("");
}

// ---------------------------------------------------------------- assemble, back to front
const stations = [
  [tray, TRAY.x + TRAY.w / 2, TRAY.y + TRAY.d / 2],
  [belt, -190, -90],
  [gate, GATE_X, -50],
  [drum, DRUM[0], DRUM[1]],
  [gearbox, BOX.x + BOX.w / 2, BOX.y + BOX.d / 2],
  [graph, GRAPH.x + GRAPH.w / 2, GRAPH.y + GRAPH.d / 2],
  [cabinet, CAB.x + CAB.w / 2, CAB.y + CAB.d / 2],
  [dial, DIAL[0], DIAL[1]],
  [diff, DIFF.x + DIFF.w / 2, DIFF.y + DIFF.d / 2],
  [ingest, ING.x + ING.w / 2, ING.y + ING.d / 2],
].sort((a, b) => depth(a[1], a[2]) - depth(b[1], b[2]));

const drawing = [base(), wires(), ...stations.map(([fn]) => fn())].join("");

// ---------------------------------------------------------------- card text around the drawing
const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const LEGEND = [
  [1, "Notes", `Markdown + YAML frontmatter · ${COUNTS.notes} notes, ${COUNTS.typed} typed; relation keys hold [[wikilinks]]`],
  [2, "Type gate", "only type: class | individual | property pass; prose and ordinary links are not assertions"],
  [3, "Indexer", "Rust → WebAssembly, offline; links resolve by label, alias or note name; IRIs minted"],
  [4, "Reasoner", `whelk-el (OWL 2 EL) in a background worker · ${COUNTS.inferred} subclass links inferred`],
  [5, "Graph view", `${COUNTS.asserted} asserted edges solid · ${COUNTS.inferred} inferred edges dashed`],
  [6, "Ontology panel", `${COUNTS.classes} classes · ${COUNTS.individuals} individual · ${COUNTS.properties} properties · ${COUNTS.diagnostics} diagnostics`],
  [7, "SPARQL console", `asserted | inferred | combined · ?c subClassOf :Animal, combined → ${rowsOf("combined")} rows`],
  [8, "Reviewed edit", "frontmatter diff; written only on Apply; refused if the note changed since preview"],
  [9, "Assisted ingest", `off by default; nothing is sent until you set an endpoint · ${PATCHED.length} grounded → 1 patch, ${WITHHELD.length} withheld (${WITHHELD.map((w) => w.verdict).join(", ")})`],
];
const LEG_Y = TOP + DRAW_H + 20;
const COL_W = (W - 64) / 3;
const CHARS = 36; // 12.5px monospace ≈ 7.5px a glyph; 36 glyphs + indent fit one column
const wrapOf = (body) => {
  const out = [""];
  for (const w of body.split(" ")) (out[out.length - 1] + " " + w).trim().length > CHARS ? out.push(w) : (out[out.length - 1] = (out[out.length - 1] + " " + w).trim());
  return out;
};
const LINES = LEGEND.map(([, , body]) => wrapOf(body));
const ROW_H = [0, 1, 2].map((row) => 24 + 14.5 * Math.max(...[0, 1, 2].map((col) => LINES[col * 3 + row].length)));
const ROW_Y = ROW_H.reduce((acc, h) => [...acc, acc[acc.length - 1] + h], [LEG_Y]);
const legend = LEGEND.map(([n, head], i) => {
  const col = Math.floor(i / 3), row = i % 3;
  const x = 32 + col * COL_W, y = ROW_Y[row];
  return (
    `<text class="om-num" x="${x}" y="${y}">${n}</text>` +
    `<text class="om-head" x="${x + 18}" y="${y}">${esc(head)}${n === 9 ? ' <tspan class="om-muted">(planned, shown on)</tspan>' : ""}</text>` +
    LINES[i].map((line, j) => `<text class="om-body" x="${x + 18}" y="${y + 17 + j * 14.5}">${esc(line)}</text>`).join("")
  );
}).join("");
const H = ROW_Y[3] + 4;

// theme: light tokens by default, dark under prefers-color-scheme; same rules as the kit
const css = (() => {
  const dark = k.ISO_CSS.match(/\.iso\{[^}]*\}/)[0];
  const light = k.ISO_CSS.match(/\.iso\[data-theme="light"\]\{[^}]*\}/)[0];
  const rest = k.ISO_CSS.replace(dark, "").replace(light, "");
  return (
    dark +
    light.replace('.iso[data-theme="light"]', ".iso") +
    `@media (prefers-color-scheme:dark){${dark}}` +
    rest +
    `.om-card{fill:var(--anatomy-card);stroke:var(--anatomy-mid);stroke-width:1}` +
    `.om-rule{stroke:var(--anatomy-faint);stroke-width:1}` +
    `.om-glass{fill:var(--anatomy-shade-0);stroke:none}` +
    `.om-void{fill:var(--anatomy-shade-0);stroke:none}` +
    `text,.iso-face-text{font-family:ui-monospace,"SF Mono",Menlo,Consolas,"DejaVu Sans Mono",monospace}` +
    `.om-fig{fill:var(--anatomy-text);font-size:14px}` +
    `.om-title{fill:var(--anatomy-muted);font-size:12px;letter-spacing:.1em}` +
    `.om-num{fill:var(--anatomy-strong);font-size:14px;font-weight:700}` +
    `.om-head{fill:var(--anatomy-strong);font-size:14px;font-weight:600}` +
    `.om-body{fill:var(--anatomy-text);font-size:12.5px}` +
    `.om-muted{fill:var(--anatomy-muted);font-weight:400}`
  );
})();

const label =
  "Isometric drawing of Ontomark as a sorting machine. Note cards in a tray pass a gate that admits only typed frontmatter, an indexing drum (Rust compiled to WebAssembly) builds the model, a reasoner gearbox derives inferred relations, and three readouts show the graph (asserted solid, inferred dashed), a four-drawer panel and a SPARQL selector. A diff window with an Apply lever writes reviewed edits back to the notes. An optional, off-by-default ingest module with a grounding stamp and a withheld tray feeds the same diff window.";

const svg =
  `<svg xmlns="http://www.w3.org/2000/svg" class="iso-svg iso" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="${esc(label)}">` +
  `<title>Ontomark anatomy</title><style>${css}</style>` +
  `<rect class="om-card" x="0.5" y="0.5" width="${W - 1}" height="${H - 1}"/>` +
  `<text class="om-fig" x="32" y="34">Fig 1 · Ontomark</text>` +
  `<text class="om-title" x="${W - 32}" y="34" text-anchor="end">HOW A NOTE BECOMES AN ONTOLOGY</text>` +
  `<g transform="translate(0 ${TOP})">${drawing}</g>` +
  `<line class="om-rule" x1="32" x2="${W - 32}" y1="${LEG_Y - 22}" y2="${LEG_Y - 22}"/>` +
  legend +
  `</svg>`;

writeFileSync(join(OUT, "ontomark-anatomy.svg"), svg);
// verification page: identical SVG inside an .iso-plate so lines.mjs / capture.mjs find it
for (const theme of ["light", "dark"]) {
  const page = `<!doctype html><meta charset="utf-8"><title>ontomark anatomy (${theme})</title><style>html{color-scheme:${theme}}body{margin:0;padding:24px;background:${theme === "light" ? "#f2f2ef" : "#0b0b0b"}}.iso-plate{max-width:${W}px;margin:0 auto;position:relative}</style><div class="iso-plate">${svg}</div>`;
  writeFileSync(join(HERE, `verify-${theme}.html`), page);
}
console.log(`wrote ontomark-anatomy.svg ${W}x${H} · ${(svg.length / 1024).toFixed(0)} KB · paths ${(svg.match(/<path/g) || []).length}`);
