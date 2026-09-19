// Mounts the theme toggle on the pages that have one: the landing page and
// the guide. Loaded as its own module script so 404.html, which has no nav,
// can stay without it.

import { mountThemeToggle } from './theme';

const button = document.getElementById('theme-toggle');
if (button instanceof HTMLButtonElement) {
  mountThemeToggle(button);
}
