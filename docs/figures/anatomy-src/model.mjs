// The one model behind the figure. Every count, edge and readout in the drawing
// and its legend is derived from this example vault, never typed by hand.

/** The notes in the input tray. Only typed notes become entities. */
export const NOTES = [
  { name: "Animal", type: "class", fm: {} },
  { name: "Mammal", type: "class", fm: { "subclass-of": ["Animal"] } },
  { name: "Dog", type: "class", fm: { "is-a": ["Mammal"] } },
  { name: "Cat", type: "class", fm: { "subclass-of": ["Mammal"] } },
  { name: "Rex", type: "individual", fm: { "instance-of": ["Dog"] } },
  { name: "Walk log", type: null, fm: {}, prose: "Took [[Rex]] to the park." },
];

const SUB = new Set(["subclass-of", "is-a"]);

/** Stage 1: typed notes become entities; frontmatter wikilinks become asserted edges. */
export function index(notes = NOTES) {
  const entities = notes.filter((note) => note.type);
  const byName = new Map(entities.map((note) => [note.name, note]));
  const asserted = [];
  for (const note of entities)
    for (const [key, targets] of Object.entries(note.fm))
      for (const target of targets)
        if (byName.has(target)) asserted.push({ from: note.name, to: target, kind: SUB.has(key) ? "sub" : "inst" });
  return { entities, ignored: notes.filter((note) => !note.type), asserted };
}

/** Stage 2: EL classification for this tiny vault is the closure of sub and inst over sub. */
export function reason({ entities, asserted }) {
  const supers = new Map(entities.map((e) => [e.name, new Set()]));
  for (const edge of asserted) if (edge.kind === "sub") supers.get(edge.from).add(edge.to);
  let grew = true;
  while (grew) {
    grew = false;
    for (const set of supers.values())
      for (const s of [...set]) for (const t of supers.get(s)) if (!set.has(t)) { set.add(t); grew = true; }
  }
  const have = new Set(asserted.map((e) => `${e.from}>${e.to}>${e.kind}`));
  const inferred = [];
  for (const [from, set] of supers) for (const to of set) if (!have.has(`${from}>${to}>sub`)) inferred.push({ from, to, kind: "sub" });
  // The plugin's graph draws inferred named subsumptions only (whelk-el keeps
  // individuals as nominals), so inferred instance-of edges are not modelled here.
  return { inferred, unsatisfiable: [] };
}

export const INDEXED = index();
export const REASONED = reason(INDEXED);

export const COUNTS = {
  notes: NOTES.length,
  typed: INDEXED.entities.length,
  classes: INDEXED.entities.filter((e) => e.type === "class").length,
  individuals: INDEXED.entities.filter((e) => e.type === "individual").length,
  properties: INDEXED.entities.filter((e) => e.type === "property").length,
  asserted: INDEXED.asserted.length,
  inferred: REASONED.inferred.length,
  diagnostics: REASONED.unsatisfiable.length,
};

/** SPARQL readout: SELECT ?c WHERE { ?c rdfs:subClassOf :Animal } over the combined dataset. */
export const QUERY_MODES = ["asserted", "inferred", "combined"];
export function rowsOf(mode) {
  const edges = mode === "asserted" ? INDEXED.asserted : mode === "inferred" ? REASONED.inferred : [...INDEXED.asserted, ...REASONED.inferred];
  return new Set(edges.filter((e) => e.kind === "sub" && e.to === "Animal").map((e) => e.from)).size;
}

/** Stage 4 (optional): one chunk in, proposals out; grounded ones form one patch. */
export const INGEST_NOTE = "Dog";
export const PROPOSALS = [
  { key: "disjoint-with", value: "Cat", quote: "a dog is never a cat", verdict: "patch" },
  { key: "subclass-of", value: "Canid", quote: "dogs are canids", verdict: "ungrounded" },
  { key: "lives-with", value: "Sam", quote: "Rex lives with Sam", verdict: "unknown_key" },
];
export const PATCHED = PROPOSALS.filter((p) => p.verdict === "patch");
export const WITHHELD = PROPOSALS.filter((p) => p.verdict !== "patch");
