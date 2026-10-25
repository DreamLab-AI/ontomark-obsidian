// The enumerated, read-only SPARQL templates the Jev query picker may choose
// from (OB-02-S1-01). Jev selects a template, one entity and a dataset; the
// query text is compiled here, in code, so a chosen answer can never smuggle
// in UPDATE/SERVICE/FROM or any form the SPARQL panel refuses, and the
// panel's row and time bounds still apply when the user presses Run.
import type { Entity } from "./protocol";
import type { TemplateOffer } from "./jev";

const PREFIXES = `PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#>
PREFIX owl: <http://www.w3.org/2002/07/owl#>
`;

interface Template extends TemplateOffer {
  build: (iri: string | null) => string;
}

const TEMPLATES: Template[] = [
  {
    id: "all-classes",
    description: "List every class with its label.",
    needsEntity: false,
    build: () =>
      `${PREFIXES}SELECT ?class ?label WHERE {\n  ?class a owl:Class .\n  OPTIONAL { ?class rdfs:label ?label }\n}\nORDER BY ?label\nLIMIT 200`,
  },
  {
    id: "subclasses-of",
    description: "List the subclasses of one class.",
    needsEntity: true,
    build: (iri) =>
      `${PREFIXES}SELECT ?sub ?label WHERE {\n  ?sub rdfs:subClassOf <${iri}> .\n  OPTIONAL { ?sub rdfs:label ?label }\n}\nORDER BY ?label\nLIMIT 200`,
  },
  {
    id: "instances-of",
    description: "List the individuals that are of one class.",
    needsEntity: true,
    build: (iri) =>
      `${PREFIXES}SELECT ?individual ?label WHERE {\n  ?individual a <${iri}> .\n  OPTIONAL { ?individual rdfs:label ?label }\n}\nORDER BY ?label\nLIMIT 200`,
  },
  {
    id: "types-of",
    description: "List the types (classes) one entity has.",
    needsEntity: true,
    build: (iri) =>
      `${PREFIXES}SELECT ?type ?label WHERE {\n  <${iri}> a ?type .\n  OPTIONAL { ?type rdfs:label ?label }\n}\nORDER BY ?label\nLIMIT 200`,
  },
  {
    id: "facts-about",
    description: "List every statement made about one entity (its predicates and values).",
    needsEntity: true,
    build: (iri) => `SELECT ?predicate ?value WHERE {\n  <${iri}> ?predicate ?value .\n}\nLIMIT 200`,
  },
];

/** What the model is offered: ids and plain descriptions only. */
export function templateOffers(): TemplateOffer[] {
  return TEMPLATES.map(({ id, description, needsEntity }) => ({ id, description, needsEntity }));
}

/** An IRI is safe to put between `<` and `>` when it has no angle brackets, quotes, braces, whitespace or control characters. */
export function safeIri(iri: string): boolean {
  // eslint-disable-next-line no-control-regex
  return iri.length > 0 && !/[<>"{}|\\^`\s\u0000-\u001f]/.test(iri);
}

/**
 * Compile a chosen template. Returns `null` when the template is unknown,
 * when it needs an entity and `entityIri` is not one of `entities`, or when
 * the IRI is not safe to embed: the caller then shows nothing.
 */
export function compileTemplate(id: string, entityIri: string | null, entities: readonly Entity[]): string | null {
  const t = TEMPLATES.find((x) => x.id === id);
  if (!t) return null;
  if (!t.needsEntity) return t.build(null);
  if (entityIri === null || !safeIri(entityIri) || !entities.some((e) => e.iri === entityIri)) return null;
  return t.build(entityIri);
}

/**
 * Entities whose label or an alias occurs in `text` (case-insensitive, on word
 * boundaries). Deterministic candidate generation: the model only chooses
 * among these. Longest label first, capped at `limit`.
 */
export function mentionedEntities(text: string, entities: readonly Entity[], limit = 20): Entity[] {
  const hay = ` ${text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim()} `;
  const hits: { e: Entity; len: number }[] = [];
  for (const e of entities) {
    let best = 0;
    for (const name of [e.label, ...e.aliases]) {
      const n = name.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
      if (n && hay.includes(` ${n} `)) best = Math.max(best, n.length);
    }
    if (best > 0) hits.push({ e, len: best });
  }
  hits.sort((a, b) => b.len - a.len || a.e.iri.localeCompare(b.e.iri));
  return hits.slice(0, limit).map((h) => h.e);
}
