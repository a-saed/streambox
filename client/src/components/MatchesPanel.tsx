import { useEffect, useState } from 'react';
import { Tv2, RefreshCw } from 'lucide-react';
import { fetchMatches } from '../lib/api';
import type { Match } from '../types';

function formatTime(utcDate: string): string {
  return new Date(utcDate).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function formatDay(utcDate: string): string {
  const d   = new Date(utcDate);
  const now  = new Date();
  const diff = Math.floor((d.setHours(0,0,0,0) - now.setHours(0,0,0,0)) / 86_400_000);
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Tomorrow';
  return new Date(utcDate).toLocaleDateString([], { weekday: 'long', month: 'short', day: 'numeric' });
}

function StatusBadge({ status }: { status: Match['status'] }) {
  if (status === 'IN_PLAY' || status === 'PAUSED') {
    return (
      <span className="flex items-center gap-1 text-[10px] font-bold text-red-400">
        <span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse" />
        LIVE
      </span>
    );
  }
  if (status === 'FINISHED') {
    return <span className="text-[10px] text-zinc-600 font-medium">FT</span>;
  }
  if (status === 'POSTPONED' || status === 'CANCELLED') {
    return <span className="text-[10px] text-zinc-600 font-medium">{status}</span>;
  }
  return null;
}

interface MatchCardProps {
  match: Match;
  onBroadcasterClick: (name: string) => void;
}

function MatchCard({ match, onBroadcasterClick }: MatchCardProps) {
  const isLive = match.status === 'IN_PLAY' || match.status === 'PAUSED';
  const score  = match.score.fullTime;
  const hasScore = score.home !== null && score.away !== null;

  return (
    <div className={`rounded-xl p-3 space-y-2.5 transition-colors
      ${isLive ? 'bg-red-950/30 border border-red-900/40' : 'bg-zinc-800/50 border border-zinc-700/30'}`}
    >
      {/* Competition */}
      <div className="flex items-center gap-1.5">
        {match.competition.emblem && (
          <img src={match.competition.emblem} alt="" className="w-3.5 h-3.5 object-contain" />
        )}
        <span className="text-[10px] text-zinc-500 font-medium truncate">{match.competition.name}</span>
        <div className="flex-1" />
        <StatusBadge status={match.status} />
        {!isLive && match.status !== 'FINISHED' && (
          <span className="text-[10px] text-zinc-500">{formatTime(match.utcDate)}</span>
        )}
      </div>

      {/* Teams */}
      <div className="flex items-center justify-between gap-2">
        {/* Home */}
        <div className="flex items-center gap-1.5 flex-1 min-w-0">
          {match.homeTeam.crest && (
            <img src={match.homeTeam.crest} alt="" className="w-5 h-5 object-contain flex-shrink-0" />
          )}
          <span className="text-xs text-zinc-200 font-medium truncate">{match.homeTeam.shortName || match.homeTeam.name}</span>
        </div>

        {/* Score / vs */}
        <div className="flex-shrink-0 text-sm font-bold text-white tabular-nums">
          {hasScore ? `${score.home} – ${score.away}` : <span className="text-zinc-600 text-xs font-normal">vs</span>}
        </div>

        {/* Away */}
        <div className="flex items-center gap-1.5 flex-1 min-w-0 justify-end">
          <span className="text-xs text-zinc-200 font-medium truncate text-right">{match.awayTeam.shortName || match.awayTeam.name}</span>
          {match.awayTeam.crest && (
            <img src={match.awayTeam.crest} alt="" className="w-5 h-5 object-contain flex-shrink-0" />
          )}
        </div>
      </div>

      {/* Broadcasters */}
      {match.broadcasters.length > 0 && (
        <div className="flex flex-wrap gap-1 pt-0.5 border-t border-zinc-700/30">
          <span className="flex items-center gap-1 text-[10px] text-zinc-600">
            <Tv2 size={10} /> Watch on:
          </span>
          {match.broadcasters.map(b => (
            <button
              key={b}
              onClick={() => onBroadcasterClick(b)}
              className="text-[10px] text-indigo-400 hover:text-indigo-300 hover:underline transition-colors"
            >
              {b}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

interface MatchesPanelProps {
  onBroadcasterClick: (name: string) => void;
}

export function MatchesPanel({ onBroadcasterClick }: MatchesPanelProps) {
  const [matches, setMatches]   = useState<Match[]>([]);
  const [loading, setLoading]   = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = async (showRefresh = false) => {
    if (showRefresh) setRefreshing(true);
    else setLoading(true);
    const data = await fetchMatches();
    setMatches(data);
    setLoading(false);
    setRefreshing(false);
  };

  useEffect(() => { load(); }, []);

  // Group by day label
  const grouped = matches.reduce<Record<string, Match[]>>((acc, m) => {
    const label = formatDay(m.utcDate);
    if (!acc[label]) acc[label] = [];
    acc[label].push(m);
    return acc;
  }, {});

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="text-center space-y-2">
          <div className="w-6 h-6 border-2 border-zinc-700 border-t-indigo-500 rounded-full animate-spin mx-auto" />
          <p className="text-zinc-600 text-xs">Loading fixtures…</p>
        </div>
      </div>
    );
  }

  if (matches.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center px-4">
        <div className="text-center space-y-2">
          <div className="text-3xl">⚽</div>
          <p className="text-zinc-500 text-sm">No upcoming matches</p>
          <p className="text-zinc-600 text-xs">Check back closer to match day</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col min-h-0">
      {/* Refresh button */}
      <div className="flex justify-end px-1 pb-1">
        <button
          onClick={() => load(true)}
          className="flex items-center gap-1 text-[10px] text-zinc-600 hover:text-zinc-400 transition-colors"
          disabled={refreshing}
        >
          <RefreshCw size={10} className={refreshing ? 'animate-spin' : ''} />
          Refresh
        </button>
      </div>

      <div className="flex-1 overflow-y-auto space-y-4 pr-0.5">
        {Object.entries(grouped).map(([day, dayMatches]) => (
          <div key={day} className="space-y-2">
            <h3 className="text-[11px] font-semibold text-zinc-500 uppercase tracking-wider px-1">{day}</h3>
            {dayMatches.map(m => (
              <MatchCard key={m.id} match={m} onBroadcasterClick={onBroadcasterClick} />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
