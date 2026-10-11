import { ItemView, TFile } from "obsidian";
import type { WorkspaceLeaf } from "obsidian";
import {hierarchyGraph, mountGraph, neighbourhood} from "@dreamlab-ai/ontomark-graph";
import type {GraphData, GraphNode, GraphView as SharedGraphView} from "@dreamlab-ai/ontomark-graph";
import type OntomarkPlugin from "../main";

export const GRAPH_VIEW="ontomark-graph";
/** Local ontology graph using Ontomark's shared renderer, without network I/O. */
export class GraphView extends ItemView {
  private renderer: SharedGraphView|null=null;
  private graph: GraphData={nodes:[],edges:[]};
  private selected: GraphNode|null=null;
  private graphEl!: HTMLElement;
  private listEl!: HTMLElement;
  private detailsEl!: HTMLElement;
  private statusEl!: HTMLElement;
  private search!: HTMLInputElement;
  private inferred!: HTMLInputElement;
  private unsubscribe:(()=>void)|null=null;
  private request=0;
  private closed=false;
  constructor(leaf:WorkspaceLeaf,private readonly plugin:OntomarkPlugin){super(leaf);}
  getViewType():string{return GRAPH_VIEW;}
  getDisplayText():string{return "Ontology graph";}
  override getIcon():string{return "network";}
  override async onOpen():Promise<void>{
    this.closed=false;const el=this.contentEl;el.empty();el.addClass("ontomark-graph-view");
    const toolbar=el.createDiv({cls:"ontomark-actions"});
    const button=(text:string,action:string,callback:()=>void)=>{const b=toolbar.createEl("button",{text,attr:{"data-ontomark-action":action}});b.addEventListener("click",callback);return b;};
    button("Refresh","graph-refresh",()=>void this.refresh());
    button("Classify","graph-classify",()=>void this.plugin.runClassify());
    button("Fit","graph-fit",()=>this.renderer?.fit());
    button("+","graph-zoom-in",()=>this.renderer?.zoomBy(1.25)).setAttribute("aria-label","Zoom in");
    button("−","graph-zoom-out",()=>this.renderer?.zoomBy(.8)).setAttribute("aria-label","Zoom out");
    button("Neighbourhood","graph-focus",()=>{if(this.selected){this.renderer?.setGraph(neighbourhood(this.graph,this.selected.id,1));this.renderer?.setSelection(this.selected.id);}});
    button("All nodes","graph-all",()=>this.renderer?.setGraph(this.graph));
    const label=toolbar.createEl("label",{text:"Include inferred "});this.inferred=label.createEl("input",{attr:{type:"checkbox","aria-label":"Include inferred graph edges"}});this.inferred.checked=true;this.inferred.addEventListener("change",()=>void this.refresh());
    this.search=el.createEl("input",{cls:"ontomark-graph-search",attr:{type:"search",placeholder:"Find an entity…","aria-label":"Search ontology graph"}});this.search.addEventListener("input",()=>this.renderList());
    this.statusEl=el.createDiv({cls:"ontomark-help"});
    this.graphEl=el.createDiv({cls:"ontomark-graph-surface"});
    this.detailsEl=el.createDiv({cls:"ontomark-graph-details"});
    this.listEl=el.createDiv({cls:"ontomark-graph-node-list",attr:{"aria-label":"Graph entities"}});
    el.createDiv({cls:"ontomark-help",text:"Drag to pan · scroll to zoom · double-click a node to open its note. Solid arrows: asserted; dashed arrows: inferred. Circles: classes; squares: individuals; diamonds: properties."});
    this.unsubscribe=this.plugin.subscribe(e=>{if(e.type==="indexed"||e.type==="classified")void this.refresh();});
    await this.refresh();
  }
  override async onClose():Promise<void>{this.closed=true;this.request++;this.unsubscribe?.();this.unsubscribe=null;this.renderer?.destroy();this.renderer=null;this.contentEl.empty();}
  async refresh():Promise<void>{
    const request=++this.request;
    try {
      await this.plugin.ready;
      const index=await this.plugin.api.index("graph-view");
      if(this.closed||request!==this.request)return;
      this.graph=hierarchyGraph(index,this.inferred.checked);
      this.statusEl.setText(`${this.graph.nodes.length} entities · ${this.graph.edges.length} hierarchy edges${index.classification&&!index.classification.complete?" · classification incomplete":""}${!index.classification?" · classify to see inferred edges":""}`);
      if(this.renderer)this.renderer.setGraph(this.graph);
      else this.renderer=mountGraph(this.graphEl,this.graph,{edgeLabelMode:"hover",onSelect:n=>this.select(n),onActivate:n=>void this.openNote(n)});
      if(this.selected&&!this.graph.nodes.some(n=>n.id===this.selected?.id))this.select(null);
      this.renderList();
    }catch(error){if(!this.closed&&request===this.request){this.statusEl.setText(error instanceof Error?error.message:String(error));}}
  }
  private select(node:GraphNode|null):void{this.selected=node;this.detailsEl.empty();if(!node)return;
    this.detailsEl.createEl("strong",{text:node.label});this.detailsEl.createEl("code",{text:node.id});
    const open=this.detailsEl.createEl("button",{text:"Open note",attr:{"data-ontomark-action":"graph-open-note"}});open.addEventListener("click",()=>void this.openNote(node));
  }
  private async openNote(node:GraphNode):Promise<void>{const index=await this.plugin.api.index("graph-open-note");const entity=index.entities.find(e=>e.iri===node.id);if(!entity)return;const file=this.app.vault.getAbstractFileByPath(entity.path);if(file instanceof TFile)await this.app.workspace.getLeaf(false).openFile(file);}
  private renderList():void{this.listEl.empty();const query=this.search.value.toLocaleLowerCase();const matches=this.graph.nodes.filter(n=>!query||n.label.toLocaleLowerCase().includes(query)||n.id.toLocaleLowerCase().includes(query));
    for(const n of matches.slice(0,100)){const b=this.listEl.createEl("button",{text:n.label,attr:{"data-ontomark-node":n.id}});b.addEventListener("click",()=>{this.renderer?.setGraph(this.graph,{preserveViewport:true});this.renderer?.setSelection(n.id);this.select(n);});}
    if(matches.length>100)this.listEl.createDiv({text:`Showing 100 of ${matches.length}; narrow the search to find any entity.`});
  }
}
