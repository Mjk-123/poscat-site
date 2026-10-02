/*
 * Games on the arcade page, in display order.
 * id    — used in the URL (game.html#id) and must match the module's meta.id
 * load  — lazy import of the module; leave it out to show the card as "Coming soon"
 * dev   — only listed when the page is opened with ?dev
 */
export const GAMES = [
  {
    id: 'merge',
    title: 'Frontier Merge',
    blurb: 'Drop AI labs into the jar. Two of a kind merge into the next one up, nine tiers to the POSCAT cat.',
    load: () => import('./merge.js'),
  },
  {
    id: 'keepup',
    title: 'Keep the Star Up',
    blurb: 'Swat the star before it falls. How long can POSCAT keep it in the air?',
  },
  {
    id: 'template',
    title: 'Template',
    blurb: 'Starter module for new games. Tap the dots before time runs out.',
    load: () => import('./template.js'),
    dev: true,
  },
];
