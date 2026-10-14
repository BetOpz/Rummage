/**
 * The default content pack. To add content, edit the JSON files in this
 * folder; no engine code changes are needed unless you add a new effect
 * type (see src/engine/effects.ts).
 */
import type { ContentPack } from '../engine/types';
import categories from './categories.json';
import specials from './specials.json';
import items from './items.json';
import blueprints from './blueprints.json';
import bossModifiers from './bosses.json';
import shopPools from './shop.json';
import starterCards from './starterCards.json';
import enemies from './enemies.json';
import minions from './minions.json';
import duelTargets from './duelTargets.json';

export const defaultContent: ContentPack = {
  categories,
  specials: specials as ContentPack['specials'],
  items: items as ContentPack['items'],
  blueprints: blueprints as ContentPack['blueprints'],
  bossModifiers,
  shopPools: shopPools as ContentPack['shopPools'],
  starterCards,
  enemies: enemies as ContentPack['enemies'],
  minions: minions as ContentPack['minions'],
  duelTargets: duelTargets as ContentPack['duelTargets'],
};
