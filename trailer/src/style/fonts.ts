import { continueRender, delayRender } from 'remotion';
// The game's own font files (public/fonts, OFL). Bundled by webpack as local assets: no network.
import bricolageUrl from '../../../public/fonts/bricolage-grotesque-latin.woff2';
import shareTechUrl from '../../../public/fonts/share-tech-mono-latin.woff2';

export const display = '"Bricolage Grotesque", system-ui, sans-serif';
export const readout = '"Share Tech Mono", ui-monospace, monospace';

let loaded = false;
export const loadFonts = (): void => {
  if (loaded || typeof document === 'undefined') return;
  loaded = true;
  const handle = delayRender('Loading game fonts');
  const faces = [
    new FontFace('Bricolage Grotesque', `url(${bricolageUrl}) format('woff2')`, { weight: '200 800' }),
    new FontFace('Share Tech Mono', `url(${shareTechUrl}) format('woff2')`),
  ];
  Promise.all(faces.map((f) => f.load()))
    .then((ready) => {
      ready.forEach((f) => document.fonts.add(f));
      continueRender(handle);
    })
    .catch((err) => {
      console.error(err);
      continueRender(handle);
    });
};
