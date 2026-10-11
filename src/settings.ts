import { PluginSettingTab, Setting } from "obsidian";
import type { App } from "obsidian";
import type { ProfileId } from "./protocol";
import type OntomarkPlugin from "./main";

/** Persisted plugin settings. */
export interface OntomarkSettings {
  profile: ProfileId;
  autoClassify: boolean;
  queryLimit: number;
}

export const DEFAULT_SETTINGS: OntomarkSettings = {
  profile: "generic",
  autoClassify: true,
  queryLimit: 1000,
};

/** Settings tab: profile, auto-classification and the SPARQL row limit. */
export class OntomarkSettingTab extends PluginSettingTab {
  constructor(
    app: App,
    private readonly plugin: OntomarkPlugin,
  ) {
    super(app, plugin);
  }

  override display(): void {
    const { containerEl } = this;
    containerEl.empty();

    containerEl.createEl("p", {
      text: "Everything runs locally on this device. Ontomark uses no network, no account and no database.",
      cls: "ontomark-privacy",
    });

    new Setting(containerEl)
      .setName("Profile")
      .setDesc("How frontmatter keys are read as ontology statements.")
      .addDropdown((d) =>
        d
          .addOption("generic", "Generic (default)")
          .addOption("estate", "Estate corpus profile (optional)")
          .setValue(this.plugin.settings.profile)
          .onChange(async (v) => {
            this.plugin.settings.profile = v === "estate" ? "estate" : "generic";
            await this.plugin.saveSettings();
            try {
              await this.plugin.api.setProfile(this.plugin.settings.profile);
            } catch (err) {
              this.plugin.reportError(err);
            }
          }),
      );

    new Setting(containerEl)
      .setName("Classify automatically")
      .setDesc("Run the reasoner shortly after the index changes.")
      .addToggle((t) =>
        t.setValue(this.plugin.settings.autoClassify).onChange(async (b) => {
          this.plugin.settings.autoClassify = b;
          await this.plugin.saveSettings();
        }),
      );

    new Setting(containerEl)
      .setName("Query row limit")
      .setDesc("Maximum rows returned by a SPARQL query.")
      .addDropdown((d) =>
        d
          .addOption("100", "100")
          .addOption("1000", "1000")
          .addOption("10000", "10000")
          .setValue(String(this.plugin.settings.queryLimit))
          .onChange(async (v) => {
            this.plugin.settings.queryLimit = Number(v);
            await this.plugin.saveSettings();
          }),
      );
  }
}
