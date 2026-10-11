import { Modal } from "obsidian";
import type { App } from "obsidian";
import type { PatchProposal } from "../protocol";

/** CSS class for one line of a unified diff. */
export function diffLineClass(line: string): string {
  if (line.startsWith("@@")) return "ontomark-diff-hunk";
  if (line.startsWith("+++") || line.startsWith("---")) return "ontomark-diff-hunk";
  if (line.startsWith("+")) return "ontomark-diff-add";
  if (line.startsWith("-")) return "ontomark-diff-del";
  return "ontomark-diff-ctx";
}

class DiffModal extends Modal {
  private settled = false;

  constructor(
    app: App,
    private readonly proposal: PatchProposal,
    private readonly resolveOnce: (value: boolean) => void,
  ) {
    super(app);
  }

  private settle(value: boolean): void {
    if (this.settled) return;
    this.settled = true;
    this.resolveOnce(value);
  }

  override onOpen(): void {
    this.titleEl.setText(`Review change to ${this.proposal.path}`);
    const { contentEl } = this;
    contentEl.empty();
    const pre = contentEl.createEl("pre", { cls: "ontomark-diff" });
    const lines = this.proposal.diff.split("\n");
    if (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
    for (const line of lines) {
      pre.createSpan({ text: line + "\n", cls: diffLineClass(line) });
    }
    const buttons = contentEl.createDiv({ cls: "ontomark-diff-buttons" });
    const apply = buttons.createEl("button", {
      text: "Apply",
      cls: "mod-cta",
      attr: { "data-ontomark-action": "apply" },
    });
    const cancel = buttons.createEl("button", {
      text: "Cancel",
      attr: { "data-ontomark-action": "cancel" },
    });
    apply.addEventListener("click", () => {
      this.settle(true);
      this.close();
    });
    cancel.addEventListener("click", () => {
      this.settle(false);
      this.close();
    });
  }

  override onClose(): void {
    this.settle(false);
    this.contentEl.empty();
  }
}

/** Show the diff of a proposal; resolves true only when the user presses Apply. */
export function confirmWithDiff(app: App, p: PatchProposal): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    new DiffModal(app, p, resolve).open();
  });
}
