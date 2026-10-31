// worker.js — the esp32sim engine in a Web Worker: host.js behind postMessage.
import { DriverHost } from './host.js';
const host = new DriverHost((msg, transfer) => postMessage(msg, transfer || []));
onmessage = (ev) => { host.handle(ev.data); };
