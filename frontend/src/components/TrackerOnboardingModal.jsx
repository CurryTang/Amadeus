import { useState } from 'react';
import axios from 'axios';

const RESEARCH_CATEGORIES = [
  { code: 'cs.AI', label: 'AI' },
  { code: 'cs.LG', label: 'ML' },
  { code: 'cs.CV', label: 'CV' },
  { code: 'cs.CL', label: 'NLP' },
  { code: 'cs.RO', label: 'Robotics' },
  { code: 'stat.ML', label: 'stat.ML' },
  { code: 'cs.NE', label: 'Neural' },
  { code: 'cs.IR', label: 'IR' },
];

function parseLines(input) {
  return String(input || '')
    .split(/[\n,\s]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function TrackerOnboardingModal({ apiUrl, getAuthHeaders, username, onDone }) {
  const [trackResearch, setTrackResearch] = useState(true);
  const [trackTwitter, setTrackTwitter] = useState(false);
  const [trackFinance, setTrackFinance] = useState(false);
  const [trackCrypto, setTrackCrypto] = useState(false);

  const [researchCategories, setResearchCategories] = useState(new Set(['cs.LG']));
  const [twitterHandlesText, setTwitterHandlesText] = useState('');
  const [financeSymbolsText, setFinanceSymbolsText] = useState('SPY\nQQQ\nAAPL');
  const [cryptoCategoriesText, setCryptoCategoriesText] = useState('BTC,ETH');

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const toggleResearchCategory = (code) => {
    setResearchCategories((prev) => {
      const next = new Set(prev);
      if (next.has(code)) next.delete(code);
      else next.add(code);
      return next;
    });
  };

  const handleSkip = () => {
    if (submitting) return;
    onDone({ created: 0, skipped: true });
  };

  const handleCreate = async (e) => {
    e.preventDefault();
    setError('');

    const payloads = [];

    if (trackResearch) {
      const categories = [...researchCategories];
      const chosen = categories.length > 0 ? categories : ['cs.LG'];
      payloads.push({
        type: 'alphaxiv',
        name: `Research Domain (${chosen.join(', ')})`,
        config: {
          categories: chosen.join(', '),
          interval: '7 Days',
          sortBy: 'Views',
          minViews: 0,
        },
      });
    }

    if (trackTwitter) {
      const handles = [...new Set(parseLines(twitterHandlesText).map((h) => h.replace(/^@/, '')))]
        .filter((h) => /^[A-Za-z0-9_]{1,15}$/.test(h));
      if (handles.length === 0) {
        setError('Twitter tracking is selected, but no valid usernames were provided.');
        return;
      }
      for (const handle of handles) {
        payloads.push({
          type: 'twitter',
          name: `Twitter @${handle}`,
          config: {
            mode: 'nitter',
            username: handle,
          },
        });
      }
    }

    if (trackFinance) {
      const symbols = [...new Set(parseLines(financeSymbolsText).map((s) => s.toUpperCase()))]
        .filter((s) => /^[A-Z0-9.^_\-=]{1,20}$/.test(s));
      if (symbols.length === 0) {
        setError('Finance tracking is selected, but no valid symbols were provided.');
        return;
      }
      payloads.push({
        type: 'finance',
        name: `Finance (${symbols.slice(0, 3).join(', ')}${symbols.length > 3 ? '…' : ''})`,
        config: {
          provider: 'yahoo_rss',
          symbols,
          maxItemsPerSymbol: 8,
          region: 'US',
          lang: 'en-US',
        },
      });
    }

    if (trackCrypto) {
      const categories = [...new Set(parseLines(cryptoCategoriesText).map((s) => s.toUpperCase()))];
      payloads.push({
        type: 'finance',
        name: `Crypto News (${categories.slice(0, 2).join(', ') || 'General'})`,
        config: {
          provider: 'cryptocompare_crypto',
          categories,
          lang: 'EN',
          maxItemsPerSymbol: 12,
        },
      });
    }

    if (payloads.length === 0) {
      setError('Select at least one tracker type before continuing.');
      return;
    }

    setSubmitting(true);
    try {
      for (const payload of payloads) {
        // eslint-disable-next-line no-await-in-loop
        await axios.post(`${apiUrl}/tracker/sources`, payload, { headers: getAuthHeaders() });
      }
      await axios.post(`${apiUrl}/tracker/feed/invalidate`, {}, { headers: getAuthHeaders() }).catch(() => {});
      onDone({ created: payloads.length, skipped: false });
    } catch (e2) {
      setError(e2.response?.data?.error || e2.message || 'Failed to create tracker sources');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="admin-panel-overlay" onClick={handleSkip}>
      <div className="admin-panel tracker-onboarding-panel" onClick={(e) => e.stopPropagation()}>
        <div className="admin-panel-header">
          <h3>Welcome{username ? `, ${username}` : ''} — Track What Matters</h3>
          <button className="close-btn" onClick={handleSkip} disabled={submitting}>×</button>
        </div>

        <div className="admin-panel-body">
          <p className="tracker-onboarding-intro">
            Pick what you want to track. You can edit this later in <strong>Tracker</strong> settings.
          </p>

          {error && <p className="admin-error">{error}</p>}

          <form className="ssh-server-form" onSubmit={handleCreate}>
            <div className="ssh-form-row tracker-onboarding-block">
              <label className="ssh-form-checkbox-label">
                <input
                  type="checkbox"
                  checked={trackResearch}
                  onChange={(e) => setTrackResearch(e.target.checked)}
                />
                Research Domain (arXiv)
              </label>
              {trackResearch && (
                <>
                  <div className="tracker-category-chips" style={{ marginTop: 8 }}>
                    {RESEARCH_CATEGORIES.map((cat) => (
                      <button
                        key={cat.code}
                        type="button"
                        className={`tracker-category-chip ${researchCategories.has(cat.code) ? 'selected' : ''}`}
                        onClick={() => toggleResearchCategory(cat.code)}
                        title={cat.code}
                      >
                        {cat.label}
                      </button>
                    ))}
                  </div>
                  <p className="ssh-form-hint">Default source is arXiv. Choose one or more subdomains.</p>
                </>
              )}
            </div>

            <div className="ssh-form-row tracker-onboarding-block">
              <label className="ssh-form-checkbox-label">
                <input
                  type="checkbox"
                  checked={trackTwitter}
                  onChange={(e) => setTrackTwitter(e.target.checked)}
                />
                Twitter/X
              </label>
              {trackTwitter && (
                <>
                  <textarea
                    value={twitterHandlesText}
                    onChange={(e) => setTwitterHandlesText(e.target.value)}
                    placeholder={'karpathy\nylecun\nAndrewYNg'}
                    rows={4}
                  />
                  <p className="ssh-form-hint">One username per line. Tracking is username-based.</p>
                </>
              )}
            </div>

            <div className="ssh-form-row tracker-onboarding-block">
              <label className="ssh-form-checkbox-label">
                <input
                  type="checkbox"
                  checked={trackFinance}
                  onChange={(e) => setTrackFinance(e.target.checked)}
                />
                Finance
              </label>
              {trackFinance && (
                <>
                  <textarea
                    value={financeSymbolsText}
                    onChange={(e) => setFinanceSymbolsText(e.target.value)}
                    placeholder={'SPY\nQQQ\nAAPL\nBTC-USD'}
                    rows={4}
                  />
                  <p className="ssh-form-hint">Using Yahoo Finance RSS headlines (free, no API key). You can switch to Finnhub/Alpha Vantage/Polygon later in Tracker settings.</p>
                </>
              )}
            </div>

            <div className="ssh-form-row tracker-onboarding-block">
              <label className="ssh-form-checkbox-label">
                <input
                  type="checkbox"
                  checked={trackCrypto}
                  onChange={(e) => setTrackCrypto(e.target.checked)}
                />
                Crypto Specific News
              </label>
              {trackCrypto && (
                <>
                  <input
                    type="text"
                    value={cryptoCategoriesText}
                    onChange={(e) => setCryptoCategoriesText(e.target.value)}
                    placeholder={'BTC,ETH,DeFi,Exchange'}
                  />
                  <p className="ssh-form-hint">Using CryptoCompare free crypto news feed.</p>
                </>
              )}
            </div>

            <div className="ssh-form-actions">
              <button type="button" className="ssh-btn-cancel" onClick={handleSkip} disabled={submitting}>
                Skip for now
              </button>
              <button type="submit" className="ssh-btn-save" disabled={submitting}>
                {submitting ? 'Creating...' : 'Create Tracking Sources'}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}

export default TrackerOnboardingModal;
