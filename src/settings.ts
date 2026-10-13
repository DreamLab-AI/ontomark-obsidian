import { PluginSettingTab, Setting } from "obsidian";
import type { App, SettingDefinitionItem, SettingGroup, SettingGroupItem } from "obsidian";
import { endpointProblem } from "./ingest-transport";
import type { ProfileId } from "./protocol";
import type OntomarkPlugin from "./main";

/** Persisted plugin settings. */
export interface OntomarkSettings {
  profile: ProfileId;
  autoClassify: boolean;
  queryLimit: number;
  /** Chat-completions URL for assisted ingest. Empty = the feature is off. */
  ingestEndpoint: string;
  /** Passed as the `model` field of the request; empty omits it. */
  ingestModel: string;
}

export const DEFAULT_SETTINGS: OntomarkSettings = {
  profile: "generic",
  autoClassify: true,
  queryLimit: 1000,
  ingestEndpoint: "",
  ingestModel: "",
};

type Key = keyof OntomarkSettings;

const PRIVACY =
  "Everything runs locally on this device. Ontomark uses no account and no database. Assisted ingest is the one exception: when you set an endpoint below, the text of the note you choose is sent to that endpoint and nowhere else.";
const KEY_DESC = "Held in memory, never saved to disk, forgotten when the plugin unloads.";

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
              validate: (v: string): string | undefined => {
                const trimmed = v.trim();
                return trimmed ? (endpointProblem(trimmed) ?? undefined) : undefined;
              },
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
            render: (setting: Setting): void => this.renderKey(setting),
          },
        ],
      },
    ];
  }

  override getControlValue(key: string): unknown {
    if (!isKey(key)) return undefined;
    const value = this.plugin.settings[key];
    return key === "queryLimit" ? String(value) : value;
  }

  /** Persist one setting; a profile change is pushed to the engine as well. */
  override async setControlValue(key: string, value: unknown): Promise<void> {
    if (!isKey(key)) return;
    const settings = this.plugin.settings as unknown as Record<Key, unknown>;
    // Dropdown controls hand back strings; the row limit is stored as a number.
    settings[key] = key === "queryLimit" ? Number(value) : typeof value === "string" ? value.trim() : value;
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
  private renderKey(setting: Setting): void {
    const status = (): string => `${KEY_DESC} Currently: ${this.plugin.ingestKey ? "set for this session" : "not set"}.`;
    setting.setDesc(status());
    setting.addText((t) => {
      t.inputEl.type = "password";
      t.inputEl.autocomplete = "off";
      t.onChange((v) => {
        this.plugin.ingestKey = v.trim();
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
          t.setValue(String(current ?? control.defaultValue ?? "")).onChange(async (v) => {
            const problem = (await control.validate?.(v)) || null;
            t.inputEl.toggleClass("ontomark-invalid", problem !== null);
            t.inputEl.title = problem ?? "";
            if (problem === null) await this.setControlValue(key, v);
          });
        });
        return;
      default:
        return;
    }
  }
}

function isKey(key: string): key is Key {
  return Object.prototype.hasOwnProperty.call(DEFAULT_SETTINGS, key);
}
