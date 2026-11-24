import { useEffect, useState } from 'react';
import { listGames } from '../../storage/db';
import { resumeGame, SetupScreen, type NewGame } from './SetupScreen';
import { TableScreen } from './TableScreen';

/** New battle (setup) → battle. `resumeId` opens a saved game straight away (Continue). */
export function GamePage({ resumeId, onSettings }: { resumeId: string | null; onSettings: () => void }) {
  const [game, setGame] = useState<NewGame | null>(null);
  useEffect(() => {
    if (!resumeId) return;
    listGames()
      .then((gs) => {
        const g = gs.find((x) => x.id === resumeId);
        if (g) setGame(resumeGame(g));
      })
      .catch(() => undefined);
  }, [resumeId]);
  if (!game) return <SetupScreen onStart={setGame} />;
  return (
    <TableScreen
      key={game.id}
      game={game}
      onSettings={onSettings}
      onQuit={() => {
        setGame(null);
        location.hash = '#home';
      }}
    />
  );
}
