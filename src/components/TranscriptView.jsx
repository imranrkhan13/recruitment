import { useState } from 'react';
import { MessageSquare, Copy, Check } from 'lucide-react';

/**
 * Renders the full final post-call transcript as speaker turns.
 * Bolna delivers the transcript only after the call ends and
 * post-processing runs, so this is always a completed-call artifact,
 * never a live feed.
 */
export default function TranscriptView({ transcript, demo }) {
  const [copied, setCopied] = useState(false);

  if (transcript === undefined || transcript === null) return null;

  const raw = String(transcript).trim();

  if (!raw) {
    return (
      <div className="transcript-block">
        <div className="transcript-head">
          <MessageSquare size={12} />
          <span>Transcript</span>
        </div>
        <div className="transcript-missing">
          {demo
            ? 'No transcript for this sample result - demo calls are simulated.'
            : 'Not available yet. The full transcript is saved when the call ends and the provider finishes processing - refresh shortly. If it stays missing, the provider did not return one for this call.'}
        </div>
      </div>
    );
  }

  // Attribution rules:
  //  - known speaker labels (assistant/user etc.) -> Aria / Candidate turns
  //  - ANY other "Label:" prefix (system, noise, unknown agent) -> its own
  //    distinct turn, never merged into someone's words
  //  - only truly unlabeled lines continue the previous turn
  const turns = [];
  for (const line0 of raw.split(/\r?\n/)) {
    const line = line0.trim();
    if (!line) continue;
    const known = line.match(/^(assistant|agent|bot|ai|user|candidate|human|customer)\s*[:-]\s*(.*)$/i);
    if (known) {
      const who = /assistant|agent|bot|ai/i.test(known[1]) ? 'aria' : 'candidate';
      turns.push({ who, text: known[2] });
      continue;
    }
    const labeled = line.match(/^([A-Za-z][A-Za-z0-9_ ]{0,24})\s*:\s*(.*)$/);
    if (labeled) {
      turns.push({ who: 'other', speaker: labeled[1].trim(), text: labeled[2] });
      continue;
    }
    if (turns.length) {
      turns[turns.length - 1].text += ' ' + line;
    } else {
      turns.push({ who: 'other', speaker: 'Transcript', text: line });
    }
  }

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(raw);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch { /* clipboard unavailable */ }
  };

  return (
    <div className="transcript-block">
      <div className="transcript-head">
        <MessageSquare size={12} />
        <span>Transcript</span>
        <span className="transcript-note">
          full provider transcript · speech recognition can err · delivered when the call ended{demo ? ' · sample data' : ''}
        </span>
        <button className="btn btn-ghost btn-sm transcript-copy" onClick={copy} title="Copy full transcript">
          {copied ? <><Check size={11} /> Copied</> : <><Copy size={11} /> Copy</>}
        </button>
      </div>
      <div className="transcript-turns">
        {turns.map((t, i) => (
          <div key={i} className={`turn turn-${t.who}`}>
            <span className="turn-speaker">
              {t.who === 'aria' ? 'Aria' : t.who === 'candidate' ? 'Candidate' : `${t.speaker} (not a speaker turn)`}
            </span>
            <span className="turn-bubble">{t.text}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
