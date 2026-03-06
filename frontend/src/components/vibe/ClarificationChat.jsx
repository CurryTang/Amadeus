import { useState, useRef, useEffect } from 'react';

export default function ClarificationChat({
  messages,
  currentQuestion,
  options,
  done,
  busy,
  skipped,
  onSend,
  onSkip,
  onUnskip,
  onProceed,
  proceedLabel,
}) {
  const [input, setInput] = useState('');
  const bottomRef = useRef(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, currentQuestion, done]);

  const handleSend = () => {
    const text = input.trim();
    if (!text || busy) return;
    setInput('');
    onSend(text);
  };

  const handleKey = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  if (skipped) {
    return (
      <div className="clarif-skipped">
        <span>Q&amp;A skipped</span>
        <button className="clarif-unskip" onClick={onUnskip}>
          Enable Q&amp;A
        </button>
      </div>
    );
  }

  return (
    <div className="clarif-chat">
      <div className="clarif-header">
        <span className="clarif-title">Context Q&amp;A</span>
        <button className="clarif-skip-btn" onClick={onSkip} title="Skip clarification questions">
          Skip Q&amp;A
        </button>
      </div>

      <div className="clarif-messages">
        {messages.map((m, i) => (
          <div key={i} className={`clarif-bubble clarif-bubble--${m.role}`}>
            {m.content}
          </div>
        ))}
        {busy && (
          <div className="clarif-bubble clarif-bubble--assistant clarif-thinking">…</div>
        )}
        {!busy && currentQuestion && (
          <div className="clarif-bubble clarif-bubble--assistant">{currentQuestion}</div>
        )}
        {!busy && done && (
          <div className="clarif-bubble clarif-bubble--assistant clarif-done">
            ✓ Got enough context. Ready to proceed.
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {!done && options && options.length > 0 && !busy && (
        <div className="clarif-options">
          {options.map((opt, i) => (
            <button
              key={i}
              className="clarif-option-btn"
              onClick={() => {
                setInput('');
                onSend(opt);
              }}
            >
              {opt}
            </button>
          ))}
        </div>
      )}

      {!done && (
        <div className="clarif-input-row">
          <textarea
            className="clarif-input"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKey}
            placeholder="Type your answer…"
            rows={2}
            disabled={busy}
          />
          <button
            className="clarif-send-btn"
            onClick={handleSend}
            disabled={!input.trim() || busy}
          >
            Send
          </button>
        </div>
      )}

      {done && (
        <button className="clarif-proceed-btn" onClick={onProceed}>
          {proceedLabel || 'Proceed'}
        </button>
      )}
    </div>
  );
}
