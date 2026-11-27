import './styles.css';
import { Game } from './game/game';

const params = new URLSearchParams(window.location.search);
const game = new Game({
  autostart: params.has('autostart'),
  skipLaunch: params.has('skipLaunch'),
});

game.load().catch((error: unknown) => {
  console.error(error);
  const loading = document.querySelector('#loading');
  if (loading) {
    loading.textContent = 'Apocalypse could not start. Your browser may not support WebGL 2.';
  }
});

if (import.meta.env.DEV) {
  // Lets automated browser checks inspect the running game.
  (window as unknown as { apocalypse: Game }).apocalypse = game;
}
