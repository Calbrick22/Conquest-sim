import { useState } from 'react';
import { SetupScreen, type NewGame } from './SetupScreen';
import { TableScreen } from './TableScreen';

export function GamePage() {
  const [game, setGame] = useState<NewGame | null>(null);
  if (!game) return <SetupScreen onStart={setGame} />;
  return <TableScreen key={game.id} game={game} onQuit={() => setGame(null)} />;
}
