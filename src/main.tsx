import { render } from 'preact';
import './styles.css';
import { App } from './ui/App';
import { ATTRACT, problem, store } from './ui/store';
import { optimize, seedFor } from './model/optimizer';
import { toIntPlan } from './model/cost';
import { startAttract } from './ui/attract';

render(<App />, document.getElementById('app')!);

if (ATTRACT) {
  // Let fonts and the first layout settle so the first frame is a clean still.
  document.fonts.ready.then(() => requestAnimationFrame(() => startAttract()));
}

// Performance check hook: runs the same optimizer on the main thread, where CPU throttling applies.
if (new URLSearchParams(location.search).get('bench') === '1') {
  (window as unknown as { __bench: () => number }).__bench = () => {
    const p = problem();
    const ip = toIntPlan(p, store.state.plan);
    return optimize(p, ip, { seed: seedFor(ip) }).ms;
  };
}
