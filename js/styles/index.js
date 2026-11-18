// Style registry. To add a style: write a class following the contract in
// CLAUDE.md / docs/ENVIRONMENT-GUIDE.md, then add it to STYLES below.
// Number keys select by index (0 = pipeline test). meta.hidden styles are
// skipped by N and auto-switching (still selectable from the dropdown).
import { TestScene } from './test-scene.js';
import { Fogway } from './fogway.js';
import { Monoliths } from './monoliths.js';
import { Relic } from './relic.js';
import { KitDemo } from './kit-demo.js';
import { DrownedRuins } from './drowned-ruins.js';

export const STYLES = [TestScene, Fogway, Monoliths, Relic, KitDemo, DrownedRuins];
