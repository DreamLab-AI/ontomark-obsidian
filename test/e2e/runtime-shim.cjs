// Browser-runtime pieces the plugin needs, on Node: a Worker that accepts a
// Blob URL (the plugin's real spawn path) backed by worker_threads, and a
// network tripwire installed in the host thread and in every worker thread.
"use strict";

const { resolveObjectURL } = require("node:buffer");
const { Worker: ThreadWorker } = require("node:worker_threads");

/** Every attempted network use, from any thread. */
const attempts = [];

// The tripwire source is shared: it runs in this thread (installTripwire) and
// is prepended to every worker's code.
const TRIPWIRE = String.raw`
(function installTripwire(report, require) {
  const deny = (what) => function () {
    report(what);
    throw new Error("network disabled by ontomark offline test: " + what);
  };
  globalThis.fetch = deny("fetch");
  globalThis.XMLHttpRequest = deny("XMLHttpRequest");
  globalThis.WebSocket = deny("WebSocket");
  globalThis.EventSource = deny("EventSource");
  if (typeof globalThis.navigator === "object" && globalThis.navigator) {
    try { globalThis.navigator.sendBeacon = deny("sendBeacon"); } catch (_) {}
  }
  const net = require("node:net");
  net.Socket.prototype.connect = deny("net.Socket.connect");
  net.connect = net.createConnection = deny("net.connect");
  const tls = require("node:tls");
  tls.connect = deny("tls.connect");
  const dns = require("node:dns");
  dns.lookup = dns.resolve = dns.resolve4 = dns.resolve6 = deny("dns");
  dns.promises.lookup = dns.promises.resolve = deny("dns.promises");
  for (const mod of ["node:http", "node:https"]) {
    const m = require(mod);
    m.request = m.get = deny(mod + ".request");
  }
  const dgram = require("node:dgram");
  dgram.createSocket = deny("dgram");
})
`;

function installTripwire() {
  // eslint-disable-next-line no-eval
  (0, eval)(TRIPWIRE)((what) => attempts.push({ thread: "main", what }), require);
}

const live = new Set();

/** DOM-style Worker over worker_threads; only Blob URLs are accepted (as in the plugin). */
class BlobWorker {
  constructor(url) {
    const blob = resolveObjectURL(url);
    if (!blob) throw new Error(`BlobWorker: ${url} is not a live Blob URL`);
    this.onmessage = null;
    this.onerror = null;
    this.terminated = false;
    this.queue = [];
    this.thread = null;
    live.add(this);
    blob.text().then((source) => {
      if (this.terminated) return;
      const prelude = `
        const { parentPort } = require("node:worker_threads");
        ${TRIPWIRE}((what) => parentPort.postMessage({ __ontomark_network_attempt: what }), require);
        globalThis.self = globalThis;
        self.postMessage = (m, t) => parentPort.postMessage(m, t);
        parentPort.on("message", (data) => { if (self.onmessage) self.onmessage({ data }); });
      `;
      this.thread = new ThreadWorker(prelude + "\n" + source, { eval: true });
      this.thread.on("message", (data) => {
        if (data && data.__ontomark_network_attempt) {
          attempts.push({ thread: "worker", what: data.__ontomark_network_attempt });
          return;
        }
        if (!this.terminated && this.onmessage) this.onmessage({ data });
      });
      this.thread.on("error", (err) => {
        if (!this.terminated && this.onerror) this.onerror(err);
      });
      for (const [m, t] of this.queue.splice(0)) this.thread.postMessage(m, t);
    });
  }
  postMessage(message, transfer) {
    if (this.terminated) return;
    if (this.thread) this.thread.postMessage(message, transfer);
    else this.queue.push([message, transfer]);
  }
  terminate() {
    this.terminated = true;
    live.delete(this);
    if (this.thread) void this.thread.terminate();
  }
}

module.exports = { attempts, installTripwire, BlobWorker, liveWorkers: () => live.size };
