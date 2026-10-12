import { Modal } from "obsidian";
import type { App } from "obsidian";
import type { CandidateAssertion, EvidenceSpan, IngestAcceptResult, Withheld } from "../protocol";
import { diffLineClass } from "./diff-modal";

/** Select `utf16` of the note in the active editor, if that note is open. */
export type RevealEvidence = (path: string, span: EvidenceSpan["utf16"]) => void;

/** The tag of a withhold reason, verbatim from the engine. */
export function reasonTag(w: Withheld): string {
  return w.reason.reason;
}

class IngestModal extends Modal {
  private settled = false;

  constructor(
    app: App,
    private readonly result: IngestAcceptResult,
    private readonly resolveOnce: (value: boolean) => void,
  ) {
    super(app);
  }

  private settle(value: boolean): void {
    if (this.settled) return;
    this.settled = true;
    this.resolveOnce(value);
  }

  /** Select the quoted range in the editor showing this note, if there is one. */
  private reveal(span: EvidenceSpan["utf16"]): void {
    const active = this.app.workspace.activeEditor;
    if (!active?.editor || active.file?.path !== this.result.path) return;
    const editor = active.editor;
    editor.setSelection(editor.offsetToPos(span.start), editor.offsetToPos(span.end));
  }

  private quote(parent: HTMLElement, ev: EvidenceSpan): void {
    const q = parent.createEl("blockquote", { text: ev.quote, cls: "ontomark-ingest-quote", attr: { "data-ontomark": "quote" } });
    q.addEventListener("click", () => this.reveal(ev.utf16));
  }

  private accepted(parent: HTMLElement, items: CandidateAssertion[]): void {
    parent.createEl("h4", { text: `Accepted (${items.length})` });
    if (items.length === 0) parent.createEl("p", { text: "Nothing was grounded in the note." });
    const ul = parent.createEl("ul", { attr: { "data-ontomark": "accepted" } });
    for (const a of items) {
      const li = ul.createEl("li");
      li.createSpan({ text: `${a.key} ← ${a.written}` });
      if (a.tier) li.createSpan({ text: ` (${a.tier})`, cls: "ontomark-ingest-tier" });
      for (const ev of a.evidence) this.quote(li, ev);
    }
  }

  private withheld(parent: HTMLElement, items: Withheld[]): void {
    parent.createEl("h4", { text: `Withheld (${items.length})` });
    const ul = parent.createEl("ul", { attr: { "data-ontomark": "withheld" } });
    for (const w of items) {
      const li = ul.createEl("li");
      li.createSpan({ text: `${w.key}: ${w.value} ` });
      li.createSpan({ text: reasonTag(w), cls: "ontomark-ingest-reason" });
      if (w.evidence) this.quote(li, w.evidence);
    }
  }

  override onOpen(): void {
    const { result, contentEl } = this;
    this.titleEl.setText(`Facts found in ${result.path}`);
    contentEl.empty();
    const preview = result.preview;
    if (preview) {
      const pre = contentEl.createEl("pre", { cls: "ontomark-diff" });
      const lines = preview.diff.split("\n");
      if (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
      for (const line of lines) pre.createSpan({ text: line + "\n", cls: diffLineClass(line) });
    } else {
      contentEl.createEl("p", { text: "No change to write." });
    }
    this.accepted(contentEl, result.candidates.accepted);
    this.withheld(contentEl, result.candidates.withheld);
    const buttons = contentEl.createDiv({ cls: "ontomark-diff-buttons" });
    const apply = buttons.createEl("button", {
      text: "Apply",
      cls: "mod-cta",
      attr: { "data-ontomark-action": "apply" },
    });
    if (!preview) apply.disabled = true;
    const cancel = buttons.createEl("button", { text: "Cancel", attr: { "data-ontomark-action": "cancel" } });
    apply.addEventListener("click", () => {
      if (!preview) return;
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

/** Show what was found and what was withheld; resolves true only when the user presses Apply. */
export function confirmIngest(app: App, result: IngestAcceptResult): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    new IngestModal(app, result, resolve).open();
  });
}
