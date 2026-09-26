import { Compass, Crown, Gavel, HeartHandshake, Scale, Sparkles, Stamp, type LucideProps } from 'lucide-react';

/** One icon per expert assistant; unknown agents get a neutral mark. */
const ICONS: Record<string, React.ComponentType<LucideProps>> = {
  'legal-leader': Crown,
  'civil-expert': Scale,
  'criminal-expert': Gavel,
  'family-expert': HeartHandshake,
  'registration-expert': Stamp,
  'legal-expert-base': Compass,
};

export function AgentIcon({ agentId, size = 22 }: { agentId: string; size?: number }) {
  const Icon = ICONS[agentId] ?? Sparkles;
  return <Icon size={size} aria-hidden="true" />;
}
