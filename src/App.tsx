import { useCallback, useEffect, useState } from 'react';
import { getActiveRound } from './db';
import {
  ActiveRound, EditHole, History, Home, Results, RoundSettings, Settings, StartRound, Stats, useDataVersion, type Go, type Route,
} from './screens';
import type { Round } from './types';

export default function App() {
  const v = useDataVersion();
  const [active, setActive] = useState<Round | null | undefined>(undefined);
  const [route, setRoute] = useState<Route | null>(null);

  useEffect(() => {
    let live = true;
    void getActiveRound().then((a) => {
      if (!live) return;
      setActive(a);
      // Cold launch: drop straight back into the hole being entered.
      setRoute((r) => r ?? (a ? { name: 'active' } : { name: 'home' }));
    });
    return () => { live = false; };
  }, [v]);

  const go: Go = useCallback((r) => { setRoute(r); window.scrollTo(0, 0); }, []);

  if (active === undefined || route === null) return null;

  // Blind-score enforcement: while a round is active, only the round itself, its blind
  // correction flow, Home and sync settings are reachable.
  const needsInactive =
    route.name === 'history' || route.name === 'stats' || (route.name === 'results' && active?.round_id !== route.id);
  const needsActive = route.name === 'active' || route.name === 'edit' || route.name === 'round-settings';
  if ((needsInactive && active) || (needsActive && !active)) return <Home active={active} go={go} />;

  switch (route.name) {
    case 'start': return <StartRound go={go} />;
    case 'active': return <ActiveRound round={active!} go={go} />;
    case 'edit': return <EditHole round={active!} go={go} />;
    case 'round-settings': return <RoundSettings key={active!.round_id} round={active!} go={go} />;
    case 'results': return <Results id={route.id} fresh={route.fresh} go={go} />;
    case 'history': return <History go={go} />;
    case 'stats': return <Stats go={go} />;
    case 'settings': return <Settings go={go} />;
    default: return <Home active={active} go={go} />;
  }
}
