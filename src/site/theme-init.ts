// Mounts the theme toggle in the header band of every site page that has one:
// the landing page, the guide and the 404 (D-40).

import { mountThemeToggle } from './theme';

const button = document.getElementById('theme-toggle');
if (button instanceof HTMLButtonElement) {
  mountThemeToggle(button);
}
