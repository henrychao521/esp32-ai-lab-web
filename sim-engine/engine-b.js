// engine-b.js — alias of engine-esp32sim.js (the task brief's name); the canvas imports the other.
export * from './engine-esp32sim.js';
export { createEsp32simEngine as createEngineB } from './engine-esp32sim.js';
