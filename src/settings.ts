import { PluginSettingTab, Setting } from "obsidian";
import { RECOMMENDED_LAYOUT_PARAMS } from "@dreamlab-ai/ontomark-graph/layout";
import type { LayoutParams } from "@dreamlab-ai/ontomark-graph/layout";
import type { App, SettingDefinitionItem, SettingGroup, SettingGroupItem } from "obsidian";
import { DEFAULT_EXCLUDED_FOLDERS, folderListProblem, parseFolderList } from "./excludes";
import { endpointProblem } from "./endpoint";
import { DEFAULT_MIN_CONFIDENCE } from "./jev";
import type { ProfileId } from "./protocol";
import type OntomarkPlugin from "./main";

/** Persisted plugin settings. */
export interface OntomarkSettings {
  profile: ProfileId;
  autoClassify: boolean;
  queryLimit: number;
  /** Top-level vault folders the engine never indexes (ADR-OBS-005). */
  excludedFolders: string[];
  /** Chat-completions URL for assisted ingest. Empty = the feature is off. */
  ingestEndpoint: string;
  /** Passed as the `model` field of the request; empty omits it. */
  ingestModel: string;
  /** The Jev option (typed decisions). Off by default; see JEV_TOGGLE_DESC. */
  jevEnabled: boolean;
  /** Full `/v1/systemone` URL the Jev option posts to. Empty = nothing is sent. */
  jevEndpoint: string;
  /** Model name for the Jev option; empty uses `jev-latest`. */
  jevModel: string;
  /** Withhold an ingest fact when Jev's support probability is at or below this. 0 = never. */
  jevWithholdAtOrBelow: number;
  /** Minimum Choice confidence for a Jev proposal (query template, frontmatter edit). */
  jevMinConfidence: number;
  /** Accept plain-http ingest and Jev endpoints on hosts other than this machine. Off by default. */
  allowInsecureHttp: boolean;
  /** Graph layout: every node is a disc of this radius in world units, so nodes settle at least twice it apart. 0 = no collision. */
  graphCollideRadius: number;
  /** Graph layout: share of an overlap resolved per pass, 0 to 1. */
  graphCollideStrength: number;
  /** Graph layout: collision passes per simulation tick, 1 to 16. */
  graphCollideIterations: number;
  /** Graph layout: pull of each disconnected component toward the centre, 0 to 1. 0 = off. */
  graphComponentGravity: number;
}

export const DEFAULT_SETTINGS: OntomarkSettings = {
  profile: "generic",
  autoClassify: true,
  queryLimit: 1000,
  excludedFolders: [...DEFAULT_EXCLUDED_FOLDERS],
  ingestEndpoint: "",
  ingestModel: "",
  jevEnabled: false,
  jevEndpoint: "",
  jevModel: "",
  jevWithholdAtOrBelow: 0,
  jevMinConfidence: DEFAULT_MIN_CONFIDENCE,
  allowInsecureHttp: false,
  // The shared renderer draws nodes at up to 12 px radius plus a label; these
  // are the vowl-wasm 0.4.0 settings chosen for that size.
  graphCollideRadius: RECOMMENDED_LAYOUT_PARAMS.collideRadius,
  graphCollideStrength: RECOMMENDED_LAYOUT_PARAMS.collideStrength,
  graphCollideIterations: RECOMMENDED_LAYOUT_PARAMS.collideIterations,
  graphComponentGravity: RECOMMENDED_LAYOUT_PARAMS.componentGravity,
};

/** The four graph layout settings, their accepted range and whether they must be whole numbers. */
export const GRAPH_LAYOUT_RANGES = {
  graphCollideRadius: { min: 0, max: 200, integer: false },
  graphCollideStrength: { min: 0, max: 1, integer: false },
  graphCollideIterations: { min: 1, max: 16, integer: true },
  graphComponentGravity: { min: 0, max: 1, integer: false },
} as const;
export type GraphLayoutKey = keyof typeof GRAPH_LAYOUT_RANGES;
const GRAPH_LAYOUT_KEYS = Object.keys(GRAPH_LAYOUT_RANGES) as GraphLayoutKey[];

export function isGraphLayoutKey(key: string): key is GraphLayoutKey {
  return Object.prototype.hasOwnProperty.call(GRAPH_LAYOUT_RANGES, key);
}

/** A message when `v` is not a number the graph layout setting `key` accepts. */
export function graphLayoutProblem(key: GraphLayoutKey, v: string): string | undefined {
  const { min, max, integer } = GRAPH_LAYOUT_RANGES[key];
  const t = v.trim();
  const n = Number(t);
  const ok = t !== "" && Number.isFinite(n) && n >= min && n <= max && (!integer || Number.isInteger(n));
  return ok ? undefined : `enter a ${integer ? "whole number" : "number"} from ${min} to ${max}`;
}

/** The layout engine's parameters (vowl-wasm `NggExplorer.setParam` keys) for the current settings. */
export function graphLayoutParams(settings: OntomarkSettings): LayoutParams {
  return {
    collideRadius: settings.graphCollideRadius,
    collideStrength: settings.graphCollideStrength,
    collideIterations: settings.graphCollideIterations,
    componentGravity: settings.graphComponentGravity,
  };
}

/** Merge saved data over the defaults, repairing a value an older version or a hand edit left malformed. */
export function normaliseSettings(saved: Partial<OntomarkSettings> | null | undefined): OntomarkSettings {
  const merged = { ...DEFAULT_SETTINGS, ...(saved ?? {}) };
  const folders = Array.isArray(merged.excludedFolders) ? merged.excludedFolders : DEFAULT_SETTINGS.excludedFolders;
  merged.excludedFolders = parseFolderList(folders.filter((f): f is string => typeof f === "string").join(","));
  // The Jev option fails closed on a hand-edited data.json: anything but a real `true` is off.
  merged.jevEnabled = merged.jevEnabled === true;
  // So does the plain-http opt-in.
  merged.allowInsecureHttp = merged.allowInsecureHttp === true;
  const unit = (v: unknown, fallback: number): number => (typeof v === "number" && v >= 0 && v <= 1 ? v : fallback);
  merged.jevWithholdAtOrBelow = unit(merged.jevWithholdAtOrBelow, DEFAULT_SETTINGS.jevWithholdAtOrBelow);
  merged.jevMinConfidence = unit(merged.jevMinConfidence, DEFAULT_SETTINGS.jevMinConfidence);
  for (const k of ["jevEndpoint", "jevModel"] as const) if (typeof merged[k] !== "string") merged[k] = "";
  for (const k of GRAPH_LAYOUT_KEYS) {
    const v = merged[k] as unknown;
    if (typeof v !== "number" || graphLayoutProblem(k, String(v))) merged[k] = DEFAULT_SETTINGS[k];
  }
  return merged;
}

type Key = keyof OntomarkSettings;

const PRIVACY =
  "Everything runs locally on this device. Ontomark uses no account and no database. Assisted ingest is the one exception: when you set an endpoint below, the text of the note you choose is sent to that endpoint and nowhere else. The optional Jev option (off by default, own endpoint) is the only other exception.";
/** What turning the Jev option on sends, and where. Shown on the toggle; the README repeats it. */
export const JEV_TOGGLE_DESC =
  "Off by default. When on, and only when you use one of these three actions, text is sent to the endpoint below and nowhere else: " +
  "Extract facts sends each proposed fact with its quote from the note, plus the note's title, for a second check; " +
  "the query panel's Ask box sends your question and the labels of the entities it mentions; " +
  "Propose frontmatter edit sends your sentence, the note's title and type, and the labels of entities it mentions. " +
  "Note bodies are not sent except as those quotes. It never writes anything: every change still shows a diff you must apply. " +
  "Do not enable it for notes you would not send to that endpoint.";
const JEV_KEY_DESC = "Held in memory, never saved to disk, forgotten when the plugin unloads. May be empty for a keyless local endpoint.";
const KEY_DESC = "Held in memory, never saved to disk, forgotten when the plugin unloads.";
/** What the plain-http opt-in gives up. Shown on the toggle; the README repeats it. */
export const INSECURE_HTTP_DESC =
  "Off by default. Endpoints must use https, except plain http to this machine (localhost, 127.x.x.x, [::1]). " +
  "Turn this on only to reach an http endpoint on another host, such as a model server on your own network: " +
  "the API key and the note text sent to it then travel unencrypted, readable by anyone on the network path.";

/**
 * Settings tab. One list of definitions serves two renderers: Obsidian 1.13+
 * renders it declaratively and indexes it for settings search; older versions
 * down to the manifest's 1.7.2 floor call `display()`, which renders the same
 * list with the imperative `Setting` API. Reads and writes go through
 * `getControlValue`/`setControlValue` in both cases.
 */
export class OntomarkSettingTab extends PluginSettingTab {
  constructor(
    app: App,
    private readonly plugin: OntomarkPlugin,
  ) {
    super(app, plugin);
  }

  override getSettingDefinitions(): SettingDefinitionItem<Key>[] {
    return [
      { name: "Local by design", desc: PRIVACY, aliases: ["privacy", "offline", "network"] },
      {
        name: "Profile",
        desc: "How frontmatter keys are read as ontology statements.",
        control: {
          type: "dropdown",
          key: "profile",
          defaultValue: DEFAULT_SETTINGS.profile,
          options: { generic: "Generic (default)", estate: "Estate corpus profile (optional)" },
        },
      },
      {
        name: "Classify automatically",
        desc: "Run the reasoner shortly after the index changes.",
        control: { type: "toggle", key: "autoClassify", defaultValue: DEFAULT_SETTINGS.autoClassify },
      },
      {
        name: "Query row limit",
        desc: "Maximum rows returned by a SPARQL query.",
        aliases: ["SPARQL", "rows"],
        // A dropdown, not a free number: the choices stay within the engine's cap.
        control: {
          type: "dropdown",
          key: "queryLimit",
          defaultValue: String(DEFAULT_SETTINGS.queryLimit),
          options: { "100": "100", "1000": "1000", "10000": "10000" },
        },
      },
      {
        name: "Excluded folders",
        desc: "Top-level folders whose notes are never indexed, comma-separated; case does not matter. Templates belong here: a template's placeholder frontmatter would otherwise become an entity or a validation error. Notes under Obsidian's own Excluded files setting are skipped as well. Changing this reindexes the vault.",
        aliases: ["templates", "ignore", "skip", "index"],
        control: {
          type: "text",
          key: "excludedFolders",
          defaultValue: DEFAULT_SETTINGS.excludedFolders.join(", "),
          placeholder: "templates, assets",
          validate: (v: string): string | undefined => folderListProblem(v),
        },
      },
      {
        type: "group",
        heading: "Graph layout",
        items: [
          {
            name: "Node spacing",
            desc: "Collision radius in graph units: nodes settle at least twice this far apart, so their discs and labels do not overlap. 21 suits the graph's node sizes; 14 packs tighter. 0 turns collision off.",
            aliases: ["graph", "layout", "collision", "overlap", "collideRadius"],
            control: { type: "text", key: "graphCollideRadius", defaultValue: String(DEFAULT_SETTINGS.graphCollideRadius), validate: (v: string): string | undefined => graphLayoutProblem("graphCollideRadius", v) },
          },
          {
            name: "Collision strength",
            desc: "A number from 0 to 1: the share of an overlap pushed apart per pass.",
            aliases: ["graph", "layout", "collision", "collideStrength"],
            control: { type: "text", key: "graphCollideStrength", defaultValue: String(DEFAULT_SETTINGS.graphCollideStrength), validate: (v: string): string | undefined => graphLayoutProblem("graphCollideStrength", v) },
          },
          {
            name: "Collision passes",
            desc: "A whole number from 1 to 16: collision passes per simulation step. More passes separate crowded nodes sooner and cost more time.",
            aliases: ["graph", "layout", "collision", "collideIterations"],
            control: { type: "text", key: "graphCollideIterations", defaultValue: String(DEFAULT_SETTINGS.graphCollideIterations), validate: (v: string): string | undefined => graphLayoutProblem("graphCollideIterations", v) },
          },
          {
            name: "Component gravity",
            desc: "A number from 0 to 1: how strongly each disconnected group of nodes is drawn toward the centre, so fragments stay near the main graph. 0 turns it off.",
            aliases: ["graph", "layout", "gravity", "componentGravity"],
            control: { type: "text", key: "graphComponentGravity", defaultValue: String(DEFAULT_SETTINGS.graphComponentGravity), validate: (v: string): string | undefined => graphLayoutProblem("graphComponentGravity", v) },
          },
        ],
      },
      {
        type: "group",
        heading: "Assisted ingest (optional, uses the network)",
        items: [
          {
            name: "Model endpoint",
            desc: "Full address of an OpenAI-compatible chat-completions endpoint. Empty keeps the feature off.",
            aliases: ["ingest", "URL", "LLM"],
            control: {
              type: "text",
              key: "ingestEndpoint",
              defaultValue: "",
              validate: (v: string): string | undefined => this.endpointValidation(v),
            },
          },
          {
            name: "Model name",
            desc: "Sent as the model field of the request.",
            aliases: ["ingest"],
            control: { type: "text", key: "ingestModel", defaultValue: "" },
          },
          {
            name: "API key (this session only)",
            desc: KEY_DESC,
            aliases: ["ingest", "token", "secret"],
            render: (setting: Setting): void => this.renderKey(setting, "ingestKey", KEY_DESC),
          },
        ],
      },
      {
        type: "group",
        heading: "Jev decisions (optional, uses the network)",
        items: [
          {
            name: "Use Jev typed decisions",
            desc: JEV_TOGGLE_DESC,
            aliases: ["jev", "typesafe", "system one", "verifier", "network"],
            control: { type: "toggle", key: "jevEnabled", defaultValue: false },
          },
          {
            name: "Jev endpoint",
            desc: "Full address of a System One endpoint (ending /v1/systemone) that you trust with the text listed above. Empty sends nothing.",
            aliases: ["jev", "URL"],
            control: {
              type: "text",
              key: "jevEndpoint",
              defaultValue: "",
              validate: (v: string): string | undefined => this.endpointValidation(v),
            },
          },
          {
            name: "Jev model",
            desc: "Sent as the model field. Empty uses jev-latest.",
            aliases: ["jev"],
            control: { type: "text", key: "jevModel", defaultValue: "" },
          },
          {
            name: "Jev API key (this session only)",
            desc: JEV_KEY_DESC,
            aliases: ["jev", "token", "secret"],
            render: (setting: Setting): void => this.renderKey(setting, "jevKey", JEV_KEY_DESC),
          },
          {
            name: "Withhold facts Jev rates at or below",
            desc: "A number from 0 to 1. Extract facts always shows a warning beside a fact Jev doubts; it drops the fact only when Jev's support score is at or below this number. 0 never drops anything. Fit it on your own examples first.",
            aliases: ["jev", "threshold"],
            control: { type: "text", key: "jevWithholdAtOrBelow", defaultValue: "0", validate: (v: string): string | undefined => unitProblem(v) },
          },
          {
            name: "Jev minimum confidence",
            desc: "A number from 0 to 1. A suggested query or edit is only offered when Jev is at least this confident; otherwise nothing is offered.",
            aliases: ["jev", "threshold"],
            control: { type: "text", key: "jevMinConfidence", defaultValue: String(DEFAULT_MIN_CONFIDENCE), validate: (v: string): string | undefined => unitProblem(v) },
          },
        ],
      },
      {
        type: "group",
        heading: "Endpoint security",
        items: [
          {
            name: "Allow plain http to other hosts",
            desc: INSECURE_HTTP_DESC,
            aliases: ["http", "insecure", "LAN", "network", "jev", "ingest"],
            control: { type: "toggle", key: "allowInsecureHttp", defaultValue: false },
          },
        ],
      },
    ];
  }

  /** The endpoint fields' message, under the plain-http setting as it is now. */
  private endpointValidation(v: string): string | undefined {
    const trimmed = v.trim();
    return trimmed ? (endpointProblem(trimmed, { allowInsecureHttp: this.plugin.settings.allowInsecureHttp }) ?? undefined) : undefined;
  }

  override getControlValue(key: string): unknown {
    if (!isKey(key)) return undefined;
    const value = this.plugin.settings[key];
    if (key === "queryLimit" || key === "jevWithholdAtOrBelow" || key === "jevMinConfidence" || isGraphLayoutKey(key)) return String(value);
    if (key === "excludedFolders") return this.plugin.settings.excludedFolders.join(", ");
    return value;
  }

  /**
   * Persist one setting. A profile change is pushed to the engine; a change
   * to the excluded folders reindexes, so the engine ends up holding exactly
   * the notes that are not excluded (a newly excluded page is removed).
   */
  override async setControlValue(key: string, value: unknown): Promise<void> {
    if (!isKey(key)) return;
    const settings = this.plugin.settings as unknown as Record<Key, unknown>;
    if (key === "excludedFolders") {
      const text = Array.isArray(value) ? value.join(",") : String(value ?? "");
      if (folderListProblem(text)) return; // the control shows the message; nothing is stored
      const next = parseFolderList(text);
      const unchanged = JSON.stringify(next) === JSON.stringify(this.plugin.settings.excludedFolders);
      settings[key] = next;
      const reindexed = await this.plugin.saveSettings();
      if (!unchanged && !reindexed) await this.plugin.reindex();
      return;
    }
    if ((key === "jevWithholdAtOrBelow" || key === "jevMinConfidence") && unitProblem(String(value ?? ""))) return; // the control shows the message
    if (isGraphLayoutKey(key)) {
      if (graphLayoutProblem(key, String(value ?? ""))) return; // the control shows the message
      settings[key] = Number(value);
      await this.plugin.saveSettings();
      this.plugin.applyGraphLayout();
      return;
    }
    // Dropdown controls hand back strings; the row limit is stored as a number.
    settings[key] =
      key === "queryLimit" || key === "jevWithholdAtOrBelow" || key === "jevMinConfidence"
        ? Number(value)
        : typeof value === "string"
          ? value.trim()
          : value;
    await this.plugin.saveSettings();
    if (key === "profile") {
      try {
        await this.plugin.api.setProfile(this.plugin.settings.profile);
      } catch (err) {
        this.plugin.reportError(err);
      }
    }
  }

  /** The session key never touches `settings`: it lives on the plugin and dies with it. */
  private renderKey(setting: Setting, field: "ingestKey" | "jevKey", desc: string): void {
    const status = (): string => `${desc} Currently: ${this.plugin[field] ? "set for this session" : "not set"}.`;
    setting.setDesc(status());
    setting.addText((t) => {
      t.inputEl.type = "password";
      t.inputEl.autocomplete = "off";
      t.onChange((v) => {
        this.plugin[field] = v.trim();
        setting.setDesc(status());
      });
    });
  }

  /** Fallback for Obsidian before 1.13: render the same definitions imperatively. */
  override display(): void {
    const { containerEl } = this;
    containerEl.empty();
    for (const item of this.getSettingDefinitions()) {
      if (!("type" in item)) {
        this.renderItem(containerEl, item);
      } else if (item.type === "group" || item.type === "list") {
        if (item.heading) new Setting(containerEl).setName(item.heading).setHeading();
        for (const child of item.items ?? []) this.renderItem(containerEl, child);
      }
      // nested pages are not used
    }
  }

  private renderItem(containerEl: HTMLElement, item: SettingGroupItem<Key>): void {
    if ("type" in item) return; // nested pages are not used
    const setting = new Setting(containerEl).setName(item.name);
    if (item.desc !== undefined) setting.setDesc(item.desc);
    if (item.render) {
      // The legacy path has no SettingGroup; our render callbacks never read it.
      item.render(setting, undefined as unknown as SettingGroup);
      return;
    }
    const control = item.control;
    if (!control) return;
    const key = control.key;
    const current = this.getControlValue(key);
    switch (control.type) {
      case "dropdown":
        setting.addDropdown((d) =>
          d
            .addOptions(control.options)
            .setValue(String(current ?? control.defaultValue ?? ""))
            .onChange((v) => void this.setControlValue(key, v)),
        );
        return;
      case "toggle":
        setting.addToggle((t) => t.setValue(Boolean(current ?? control.defaultValue)).onChange((v) => void this.setControlValue(key, v)));
        return;
      case "text":
        setting.addText((t) => {
          if (control.placeholder) t.setPlaceholder(control.placeholder);
          t.setValue(String(current ?? control.defaultValue ?? ""));
          // The DOM `change` event, not every keystroke: it fires when the value
          // is committed (blur or Enter), which matters for a control whose
          // change reindexes the vault.
          t.inputEl.addEventListener("change", () => {
            void (async () => {
              const v = t.inputEl.value;
              const problem = (await control.validate?.(v)) || null;
              t.inputEl.toggleClass("ontomark-invalid", problem !== null);
              t.inputEl.title = problem ?? "";
              if (problem === null) await this.setControlValue(key, v);
            })();
          });
        });
        return;
      default:
        return;
    }
  }
}

/** A message when `v` is not a number from 0 to 1. */
function unitProblem(v: string): string | undefined {
  const t = v.trim();
  const n = Number(t);
  return t !== "" && Number.isFinite(n) && n >= 0 && n <= 1 ? undefined : "enter a number from 0 to 1";
}

function isKey(key: string): key is Key {
  return Object.prototype.hasOwnProperty.call(DEFAULT_SETTINGS, key);
}
