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
import { ColdBase } from './cold-base.js';
import { StationDeck } from './station-deck.js';
import { DreamJournal } from './dream-journal.js';
import { GraveyardHill } from './graveyard-hill.js';
import { ArcadeAfterHours } from './arcade-after-hours.js';
import { AuroraField } from './aurora-field.js';
import { KitCalm } from './kit-calm.js';
import { LanternRiver } from './lantern-river.js';
import { RainWindow } from './rain-window.js';
import { CloudSea } from './cloud-sea.js';
import { PetalSteps } from './petal-steps.js';
import { MoonlitShallows } from './moonlit-shallows.js';
import { GreenhouseDusk } from './greenhouse-dusk.js';
import { QuietHouse } from './quiet-house.js';
import { MothLamp } from './moth-lamp.js';
import { UnderTheHull } from './under-the-hull.js';
import { StillPool } from './still-pool.js';
import { Underriver } from './underriver.js';
import { BeforeDawn } from './before-dawn.js';
import { SaltFlat } from './salt-flat.js';

import { SearchlightTown } from './searchlight-town.js';

import { BackRoadLights } from './back-road-lights.js';

import { PaperCrowd } from './paper-crowd.js';

import { Newsprint } from './newsprint.js';

export const STYLES = [TestScene, Fogway, Monoliths, Relic, KitDemo, AshfallTown, LostValley, NeonCircuit, NightManor, DrownedRuins, RouteNine, ColdBase, StationDeck, DreamJournal, GraveyardHill, ArcadeAfterHours, AuroraField, KitCalm, LanternRiver, RainWindow, CloudSea, PetalSteps, MoonlitShallows, GreenhouseDusk, QuietHouse, MothLamp, UnderTheHull, StillPool, Underriver, BeforeDawn, SaltFlat, SearchlightTown, BackRoadLights, PaperCrowd, Newsprint];
