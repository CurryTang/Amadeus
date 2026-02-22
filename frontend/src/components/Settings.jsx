import { useState } from 'react';

function Settings({ apiUrl, onApiUrlChange, onClose }) {
  const [url, setUrl] = useState(apiUrl);

  const handleSave = () => {
    // Remove trailing slash if present
    const cleanUrl = url.replace(/\/+$/, '');
    onApiUrlChange(cleanUrl);
    onClose();
  };

  return (
    <div className="settings-panel">
      <div className="settings-header">
        <h3>Settings</h3>
        <button className="close-btn" onClick={onClose}>
          ×
        </button>
      </div>
      <div className="settings-content">
        <div className="form-group">
          <label htmlFor="apiUrl">API URL</label>
          <input
            type="text"
            id="apiUrl"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="http://localhost:3000/api"
          />
          <p className="hint">
            Enter your backend API URL. For local testing, use http://localhost:3000/api
          </p>
        </div>
        <div className="settings-actions">
          <button className="btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button className="btn-primary" onClick={handleSave}>
            Save
          </button>
        </div>
      </div>
    </div>
  );
}

export default Settings;
