// Style registry. To add a style: write a class with
//   static meta = { name }
//   init(renderer)                       create meshes/textures
//   update(audioData, intensity, dt)     advance state (multiply reactions by intensity!)
//   render(renderer)                     clear, set camera/fog/light, draw()
//   dispose(renderer)                    free GPU resources
// then add it to STYLES below. Index 0 is the pipeline test scene (key 0).
import { TestScene } from './test-scene.js';
import { Fogway } from './fogway.js';
import { Monoliths } from './monoliths.js';
import { Relic } from './relic.js';

export const STYLES = [TestScene, Fogway, Monoliths, Relic];
