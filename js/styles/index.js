// Style registry. To add a style: write a class following the contract in
// CLAUDE.md / docs/ENVIRONMENT-GUIDE.md, then add it to STYLES below.
// Number keys select by index (0 = pipeline test). meta.hidden styles are
// skipped by N and auto-switching (still selectable from the dropdown).
import { TestScene } from './test-scene.js';
import { Fogway } from './fogway.js';
import { Monoliths } from './monoliths.js';
import { Relic } from './relic.js';
import { KitDemo } from './kit-demo.js';
import { AshfallTown } from './ashfall-town.js';
import { LostValley } from './lost-valley.js';
import { NeonCircuit } from './neon-circuit.js';
import { NightManor } from './night-manor.js';
import { DrownedRuins } from './drowned-ruins.js';
import { RouteNine } from './route-nine.js';
import { StationDeck } from './station-deck.js';

export const STYLES = [TestScene, Fogway, Monoliths, Relic, KitDemo, AshfallTown, LostValley, NeonCircuit, NightManor, DrownedRuins, RouteNine, StationDeck];
