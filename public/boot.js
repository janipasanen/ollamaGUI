(function () {
  'use strict';

  function showError(label, detail) {
    var root = document.getElementById('root');
    if (!root) return;
    var message = detail && (detail.message || detail.reason || detail.stack || detail);
    root.innerHTML = '';
    var panel = document.createElement('div');
    panel.style.cssText = 'font-family:-apple-system,sans-serif;padding:2rem;color:#8b0000;white-space:pre-wrap';
    panel.textContent = 'OllamaGUI failed to load its frontend.\n\n' + label + ': ' + String(message || 'Unknown error');
    root.appendChild(panel);
  }

  window.addEventListener('error', function (event) {
    showError('JavaScript error', event.message || event.error || 'Unknown error');
    var panel = document.querySelector('#root > div');
    if (panel && event.filename) {
      panel.textContent += '\n\nLocation: ' + event.filename + ':' + event.lineno + ':' + event.colno;
    }
  }, true);
  window.addEventListener('unhandledrejection', function (event) {
    showError('Unhandled promise rejection', event.reason);
  });
}());
